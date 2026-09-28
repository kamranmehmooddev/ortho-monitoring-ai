package ai.orthomonitoring.patient

import ai.orthomonitoring.patient.data.Api
import ai.orthomonitoring.patient.data.Session
import ai.orthomonitoring.patient.queue.Connectivity
import ai.orthomonitoring.patient.queue.QueueStore
import ai.orthomonitoring.patient.queue.UploadWorker
import ai.orthomonitoring.patient.reminders.ReminderWorker
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import coil.ImageLoader
import coil.ImageLoaderFactory

class AppContainer(app: Application) {
    val session = Session(app)
    val api = Api(session)
    val queue = QueueStore(app)
    val connectivity = Connectivity(app)
}

class OmaApp : Application(), ImageLoaderFactory {
    lateinit var container: AppContainer

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        getSystemService(NotificationManager::class.java).apply {
            createNotificationChannel(NotificationChannel(CHANNEL_REMINDERS, getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_DEFAULT))
            createNotificationChannel(NotificationChannel(CHANNEL_UPDATES, getString(R.string.channel_updates), NotificationManager.IMPORTANCE_HIGH))
        }
        ReminderWorker.schedule(this)
        UploadWorker.schedule(this) // resume anything left in the outbox
    }

    /** Coil uses the authenticated OkHttp client so clinic-approved images load with the session token (never cached to disk). */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this).okHttpClient(container.api.http).diskCache { null }.respectCacheHeaders(true).build()

    companion object { const val CHANNEL_REMINDERS = "reminders"; const val CHANNEL_UPDATES = "updates" }
}
