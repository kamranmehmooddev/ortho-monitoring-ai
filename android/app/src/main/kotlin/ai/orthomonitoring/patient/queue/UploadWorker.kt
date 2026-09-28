package ai.orthomonitoring.patient.queue

import ai.orthomonitoring.core.QueuedCheckin
import ai.orthomonitoring.core.UploadPolicy
import ai.orthomonitoring.patient.OmaApp
import ai.orthomonitoring.patient.data.ApiException
import ai.orthomonitoring.patient.data.CreateCheckin
import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Drains the encrypted outbox: create check-in → upload each photo → submit. Each step is idempotent on the
 * server, so the worker can be killed at any point and simply resumes. Runs only with network connectivity.
 */
class UploadWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as OmaApp).container
        val store = c.queue
        var retry = false
        for (item in store.items.value.filter { !it.submitted }) {
            try { process(item, c.queue, c.api) } catch (e: ApiException) {
                store.update(item.clientUuid) { it.copy(attempts = it.attempts + 1, lastError = e.message) }
                if (UploadPolicy.isRetryable(e.status)) retry = true
            } catch (e: Exception) {
                store.update(item.clientUuid) { it.copy(attempts = it.attempts + 1, lastError = e.message) }
                retry = true
            }
        }
        store.prune()
        return if (retry) Result.retry() else Result.success()
    }

    private suspend fun process(start: QueuedCheckin, store: QueueStore, api: ai.orthomonitoring.patient.data.Api) {
        var cur = start
        if (cur.phase == QueuedCheckin.Phase.CREATE) {
            val created = api.createCheckin(CreateCheckin(cur.clientUuid, cur.reportedAligner, cur.wear, cur.fit, cur.symptoms, cur.painLevel, cur.concerns))
            store.update(cur.clientUuid) { it.copy(serverId = created.id) }
            cur = cur.copy(serverId = created.id)
        }
        val checkinId = cur.serverId ?: cur.retakeOf ?: return
        while (true) {
            val next = UploadPolicy.next(cur) ?: break
            val updated = try {
                val r = api.uploadImage(checkinId, store.readPhoto(next), next.view.apiName, next.withAligner, next.patientOverride, next.capturedAt)
                UploadPolicy.onImageResult(next, 200, r.id)
            } catch (e: ApiException) { UploadPolicy.onImageResult(next, e.status, null).also { if (UploadPolicy.isRetryable(e.status)) { persist(store, cur, it); throw e } } }
            catch (e: java.io.IOException) { UploadPolicy.onImageResult(next, null, null).also { persist(store, cur, it); throw e } }
            cur = cur.copy(images = cur.images.map { if (it.localId == next.localId) updated else it })
            store.update(cur.clientUuid) { cur }
            setProgress(androidx.work.workDataOf("progress" to cur.progress))
        }
        if (cur.phase == QueuedCheckin.Phase.SUBMIT) {
            api.submit(checkinId)
            store.update(cur.clientUuid) { it.copy(submitted = true, lastError = null) }
        }
    }

    private suspend fun persist(store: QueueStore, cur: QueuedCheckin, img: ai.orthomonitoring.core.QueuedImage) =
        store.update(cur.clientUuid) { c -> c.copy(images = c.images.map { if (it.localId == img.localId) img else it }) }

    companion object {
        private const val NAME = "oma-upload"
        fun schedule(context: Context) {
            val req = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
        }
    }
}
