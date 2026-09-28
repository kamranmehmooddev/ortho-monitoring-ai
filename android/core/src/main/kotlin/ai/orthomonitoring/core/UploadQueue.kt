package ai.orthomonitoring.core

import kotlin.math.min
import kotlin.math.pow

/**
 * Offline-safe check-in upload model. Everything is idempotent on the server (client UUID for check-ins,
 * content hash for images), so any step can be retried after a crash, reboot or lost connection.
 */
enum class ItemState { PENDING, UPLOADING, DONE, FAILED_PERMANENT }

data class QueuedImage(val localId: String, val view: CaptureView, val withAligner: Boolean, val file: String, val sha256: String,
                       val patientOverride: Boolean, val capturedAt: String, val state: ItemState = ItemState.PENDING, val attempts: Int = 0, val serverId: String? = null)

data class QueuedCheckin(
    val clientUuid: String, val createdAt: String, val reportedAligner: Int?, val wear: String?, val fit: String?, val symptoms: List<String>,
    val painLevel: Int, val concerns: String?, val images: List<QueuedImage>, val serverId: String? = null, val submitted: Boolean = false,
    /** When set, images are added to an existing server check-in that asked for a retake. */
    val retakeOf: String? = null, val attempts: Int = 0, val lastError: String? = null,
) {
    val phase: Phase get() = when {
        submitted -> Phase.SUBMITTED
        images.any { it.state == ItemState.FAILED_PERMANENT } -> Phase.NEEDS_ATTENTION
        (serverId ?: retakeOf) == null -> Phase.CREATE
        images.any { it.state != ItemState.DONE } -> Phase.UPLOAD_IMAGES
        else -> Phase.SUBMIT
    }
    val progress: Float get() = if (images.isEmpty()) 0f else images.count { it.state == ItemState.DONE }.toFloat() / images.size
    enum class Phase { CREATE, UPLOAD_IMAGES, SUBMIT, SUBMITTED, NEEDS_ATTENTION }
}

object UploadPolicy {
    const val MAX_ATTEMPTS = 12
    /** Exponential backoff with cap: 15 s, 30 s, 1 m, 2 m … up to 30 min. */
    fun backoffMs(attempt: Int): Long = min(30 * 60_000L, (15_000L * 2.0.pow(attempt.coerceAtMost(10))).toLong())

    /** HTTP status → retry decision. 4xx (except 408/409/429) are permanent: the file is invalid or the check-in closed. */
    fun isRetryable(status: Int?): Boolean = status == null || status == 408 || status == 429 || status >= 500
    /** 409 on an image upload means the check-in no longer accepts photos: treat as done so the queue can drain. */
    fun isAlreadyClosed(status: Int?) = status == 409

    fun onImageResult(img: QueuedImage, status: Int?, serverId: String?): QueuedImage = when {
        status != null && status in 200..299 -> img.copy(state = ItemState.DONE, serverId = serverId, attempts = img.attempts + 1)
        isAlreadyClosed(status) -> img.copy(state = ItemState.DONE, attempts = img.attempts + 1)
        !isRetryable(status) || img.attempts + 1 >= MAX_ATTEMPTS -> img.copy(state = ItemState.FAILED_PERMANENT, attempts = img.attempts + 1)
        else -> img.copy(state = ItemState.PENDING, attempts = img.attempts + 1)
    }

    /** Next image to send: smallest attempt count first so one bad file never blocks the rest. */
    fun next(c: QueuedCheckin): QueuedImage? = c.images.filter { it.state == ItemState.PENDING }.minByOrNull { it.attempts }
}

/** Patient-facing status of a check-in, merged from the local queue and the server. */
object CheckinStatus {
    data class Label(val title: String, val detail: String, val tone: Tone)
    enum class Tone { INFO, ATTENTION, STABLE, PROGRESS }

    fun local(c: QueuedCheckin, online: Boolean): Label = when (c.phase) {
        QueuedCheckin.Phase.SUBMITTED -> Label("Received", "Sent securely to your clinic.", Tone.STABLE)
        QueuedCheckin.Phase.NEEDS_ATTENTION -> Label("Needs attention", "A photo could not be sent. Please retake it.", Tone.ATTENTION)
        else -> if (online) Label("Uploading", "${(c.progress * 100).toInt()}% sent", Tone.PROGRESS)
                else Label("Waiting for connection", "Saved safely on this phone. It will send automatically.", Tone.INFO)
    }

    fun server(status: String): Label = when (status) {
        "uploading", "quality_check" -> Label("Checking photos", "Making sure your photos are clear.", Tone.PROGRESS)
        "awaiting_review" -> Label("Awaiting review", "Your orthodontist will review it soon.", Tone.INFO)
        "retake_requested" -> Label("New photos needed", "Some photos need to be retaken.", Tone.ATTENTION)
        "reviewed" -> Label("Feedback received", "Your orthodontist has replied.", Tone.STABLE)
        else -> Label(status, "", Tone.INFO)
    }
}
