package ai.orthomonitoring.patient.reminders

import ai.orthomonitoring.patient.MainActivity
import ai.orthomonitoring.patient.OmaApp
import ai.orthomonitoring.patient.R
import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.LocalDateTime
import java.time.LocalTime

/** Daily evening reminder when a check-in or retake is due, or when clinic feedback is waiting. Non-clinical content only. */
class ReminderWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as OmaApp).container
        if (!c.session.reminders || c.session.token.value == null) return Result.success()
        val home = runCatching { c.api.home() }.getOrElse { return Result.retry() }
        val (title, body) = when (home.action.kind) {
            "checkin" -> "Time for your check-in" to "${home.action.detail}. It only takes a few minutes."
            "retake" -> "A few photos need retaking" to home.action.detail
            "switch" -> home.action.title to home.action.detail
            else -> if (home.unreadMessages > 0) "New message from ${home.clinic.name}" to "Open the app to read it." else return Result.success()
        }
        if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            android.os.Build.VERSION.SDK_INT >= 33) return Result.success()
        val intent = PendingIntent.getActivity(applicationContext, 0, Intent(applicationContext, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        NotificationManagerCompat.from(applicationContext).notify(1001, NotificationCompat.Builder(applicationContext, OmaApp.CHANNEL_REMINDERS)
            .setSmallIcon(R.drawable.ic_launcher_foreground).setContentTitle(title).setContentText(body).setContentIntent(intent).setAutoCancel(true).build())
        return Result.success()
    }

    companion object {
        fun schedule(context: Context, hour: Int = 19) {
            val now = LocalDateTime.now()
            var next = now.with(LocalTime.of(hour, 0))
            if (next.isBefore(now)) next = next.plusDays(1)
            val req = PeriodicWorkRequestBuilder<ReminderWorker>(Duration.ofDays(1))
                .setInitialDelay(Duration.between(now, next))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("oma-reminder", ExistingPeriodicWorkPolicy.UPDATE, req)
        }
    }
}
