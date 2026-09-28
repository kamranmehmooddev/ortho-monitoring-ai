package ai.orthomonitoring.core

/** Wear-time helpers for the patient's log and streaks. */
object Wear {
    fun bucket(hours: Double): String = when { hours < 16 -> "<16"; hours < 20 -> "16-20"; hours < 22 -> "20-22"; else -> "22+" }
    /** Consecutive days (ending today) meeting the target. */
    fun streak(hoursNewestFirst: List<Double?>, target: Double): Int = hoursNewestFirst.takeWhile { it != null && it >= target }.size
}
