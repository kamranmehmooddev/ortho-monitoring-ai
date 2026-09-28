package ai.orthomonitoring.patient.queue

import ai.orthomonitoring.core.CaptureView
import ai.orthomonitoring.core.ItemState
import ai.orthomonitoring.core.QueuedCheckin
import ai.orthomonitoring.core.QueuedImage
import ai.orthomonitoring.patient.data.SecureFiles
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/**
 * Durable, encrypted outbox for check-ins. The manifest and every photo are AES-GCM encrypted with a Keystore key,
 * survive process death and reboots, and are removed once the server confirms receipt.
 */
class QueueStore(context: Context) {
    private val dir = File(context.filesDir, "outbox").apply { mkdirs() }
    private val manifest = File(dir, "manifest.enc")
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val mutex = Mutex()
    private val _items = MutableStateFlow(load())
    val items: StateFlow<List<QueuedCheckin>> = _items

    @Serializable private data class Img(val localId: String, val view: String, val withAligner: Boolean, val file: String, val sha256: String, val patientOverride: Boolean,
                                         val capturedAt: String, val state: String, val attempts: Int, val serverId: String? = null)
    @Serializable private data class Chk(val clientUuid: String, val createdAt: String, val reportedAligner: Int?, val wear: String?, val fit: String?, val symptoms: List<String>, val painLevel: Int,
                                         val concerns: String?, val images: List<Img>, val serverId: String?, val submitted: Boolean, val retakeOf: String?, val attempts: Int, val lastError: String?)

    private fun toDto(c: QueuedCheckin) = Chk(c.clientUuid, c.createdAt, c.reportedAligner, c.wear, c.fit, c.symptoms, c.painLevel, c.concerns,
        c.images.map { Img(it.localId, it.view.apiName, it.withAligner, it.file, it.sha256, it.patientOverride, it.capturedAt, it.state.name, it.attempts, it.serverId) },
        c.serverId, c.submitted, c.retakeOf, c.attempts, c.lastError)
    private fun fromDto(c: Chk) = QueuedCheckin(c.clientUuid, c.createdAt, c.reportedAligner, c.wear, c.fit, c.symptoms, c.painLevel, c.concerns,
        c.images.map { QueuedImage(it.localId, CaptureView.from(it.view), it.withAligner, it.file, it.sha256, it.patientOverride, it.capturedAt, ItemState.valueOf(it.state), it.attempts, it.serverId) },
        c.serverId, c.submitted, c.retakeOf, c.attempts, c.lastError)

    private fun load(): List<QueuedCheckin> = runCatching { json.decodeFromString<List<Chk>>(String(SecureFiles.read(manifest))).map(::fromDto) }.getOrDefault(emptyList())
    private fun persist(list: List<QueuedCheckin>) { SecureFiles.write(manifest, json.encodeToString(list.map(::toDto)).toByteArray()); _items.value = list }

    /** Stores a captured photo encrypted on disk and returns its queue entry. */
    fun stagePhoto(checkinUuid: String, view: CaptureView, withAligner: Boolean, jpeg: ByteArray, override: Boolean): QueuedImage {
        val id = UUID.randomUUID().toString()
        val f = File(dir, "$checkinUuid/$id.enc")
        SecureFiles.write(f, jpeg)
        val sha = MessageDigest.getInstance("SHA-256").digest(jpeg).joinToString("") { "%02x".format(it) }
        return QueuedImage(id, view, withAligner, f.absolutePath, sha, override, Instant.now().toString())
    }
    fun readPhoto(img: QueuedImage): ByteArray = SecureFiles.read(File(img.file))

    suspend fun enqueue(c: QueuedCheckin) = mutex.withLock { persist(_items.value.filterNot { it.clientUuid == c.clientUuid } + c) }
    suspend fun update(uuid: String, fn: (QueuedCheckin) -> QueuedCheckin) = mutex.withLock { persist(_items.value.map { if (it.clientUuid == uuid) fn(it) else it }) }

    /** Deletes encrypted photos of submitted check-ins; keeps the entry briefly so the UI can show "Received". */
    suspend fun prune() = mutex.withLock {
        val cutoff = Instant.now().minusSeconds(3 * 86400).toString()
        _items.value.filter { it.submitted }.forEach { c -> File(dir, c.clientUuid).deleteRecursively() }
        persist(_items.value.filterNot { it.submitted && it.createdAt < cutoff })
    }
    suspend fun clear() = mutex.withLock { dir.listFiles()?.forEach { it.deleteRecursively() }; _items.value = emptyList() }
}
