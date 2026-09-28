package ai.orthomonitoring.core

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * On-device image quality (quality-v1.2), mirroring the server's deterministic service so the patient
 * gets the same verdict before upload. Works on luma (live camera frames, Y plane) or ARGB pixels (captured photo).
 */
object Quality {
    const val VERSION = "quality-v1.2"
    const val MIN_SHORT_EDGE = 720
    const val LUMA_MIN = 70.0
    const val LUMA_MAX = 215.0
    const val CLIP_MAX = 0.12
    const val CONTRAST_MIN = 28.0
    const val SHARP_HARD = 25.0
    const val SHARP_SOFT = 60.0
    const val FRAMING_MIN = 0.12

    enum class Status { USABLE, LIMITED, UNUSABLE }
    enum class CheckId { RESOLUTION, EXPOSURE, CLIPPING, CONTRAST, SHARPNESS, FRAMING }
    data class Check(val id: CheckId, val passed: Boolean, val hard: Boolean, val value: Double)
    data class Result(
        val status: Status, val meanLuma: Double, val clipped: Double, val contrast: Double,
        val sharpness: Double, val framing: Double, val checks: List<Check>, val tip: String?,
    ) {
        /** Live-preview readiness: every check passes (the shutter turns green). */
        val ready get() = checks.all { it.passed }
    }

    fun isOcclusal(view: CaptureView) = view == CaptureView.UPPER || view == CaptureView.LOWER

    /** Analyse a luma plane (0–255) with optional tooth mask. [stride] supports camera Y planes with row padding. */
    fun analyzeLuma(
        luma: ByteArray, width: Int, height: Int, stride: Int = width, view: CaptureView, fullShortEdge: Int = min(width, height),
        toothMask: ((x: Int, y: Int, l: Int) -> Boolean)? = null,
    ): Result {
        // Downsample to ~256 px on the long edge (box average) to make metrics resolution independent.
        val scale = max(width, height) / 256.0
        val w = max(8, (width / scale).roundToInt()); val h = max(8, (height / scale).roundToInt())
        val plane = DoubleArray(w * h)
        val tooth = BooleanArray(w * h)
        for (y in 0 until h) for (x in 0 until w) {
            val sx0 = (x * scale).toInt(); val sy0 = (y * scale).toInt()
            val sx1 = min(width, ((x + 1) * scale).toInt()); val sy1 = min(height, ((y + 1) * scale).toInt())
            val step = max(1, (sx1 - sx0) / 3)
            var sum = 0.0; var n = 0; var toothVotes = 0
            var yy = sy0
            while (yy < max(sy1, sy0 + 1)) {
                var xx = sx0
                while (xx < max(sx1, sx0 + 1)) {
                    val l = luma[yy * stride + xx].toInt() and 0xFF
                    sum += l; n++
                    if (toothMask?.invoke(xx, yy, l) ?: (l > 150)) toothVotes++
                    xx += step
                }
                yy += step
            }
            plane[y * w + x] = sum / n
            tooth[y * w + x] = toothVotes * 2 >= n
        }
        return metrics(plane, tooth, w, h, fullShortEdge, view)
    }

    /** Analyse ARGB pixels of a captured photo (uses the same enamel colour heuristic as the server). */
    fun analyzeArgb(argb: IntArray, width: Int, height: Int, view: CaptureView, fullShortEdge: Int = min(width, height)): Result {
        val luma = ByteArray(width * height)
        val sat = FloatArray(width * height)
        for (i in argb.indices) {
            val p = argb[i]; val r = (p shr 16) and 0xFF; val g = (p shr 8) and 0xFF; val b = p and 0xFF
            luma[i] = (0.299 * r + 0.587 * g + 0.114 * b).roundToInt().coerceIn(0, 255).toByte()
            val mx = max(r, max(g, b)); val mn = min(r, min(g, b))
            sat[i] = if (mx == 0) 0f else (mx - mn).toFloat() / mx * (if (r >= b - 10) 1f else 9f)
        }
        return analyzeLuma(luma, width, height, width, view, fullShortEdge) { x, y, l -> l > 150 && sat[y * width + x] < 0.28f }
    }

    private fun metrics(plane: DoubleArray, tooth: BooleanArray, w: Int, h: Int, shortEdge: Int, view: CaptureView): Result {
        val n = plane.size
        var sum = 0.0; var clipped = 0
        for (v in plane) { sum += v; if (v >= 250 || v <= 5) clipped++ }
        val mean = sum / n
        var varSum = 0.0
        for (v in plane) varSum += (v - mean) * (v - mean)
        val contrast = sqrt(varSum / n)
        var lSum = 0.0; var lSq = 0.0; var lN = 0
        for (y in 1 until h - 1) for (x in 1 until w - 1) {
            val i = y * w + x
            val v = plane[i - w] + plane[i + w] + plane[i - 1] + plane[i + 1] - 4 * plane[i]
            lSum += v; lSq += v * v; lN++
        }
        val lMean = lSum / lN
        val sharpness = lSq / lN - lMean * lMean
        var inside = 0; var toothIn = 0
        for (y in 0 until h) for (x in 0 until w) {
            val dx = (x - w / 2.0) / (w * 0.42); val dy = (y - h / 2.0) / (h * 0.36)
            val r2 = dx * dx + dy * dy
            val ok = if (isOcclusal(view)) r2 in 0.3..1.25 else r2 <= 1
            if (ok) { inside++; if (tooth[y * w + x]) toothIn++ }
        }
        val framing = if (inside == 0) 0.0 else toothIn.toDouble() / inside
        val clipShare = clipped.toDouble() / n
        val checks = listOf(
            Check(CheckId.RESOLUTION, shortEdge >= MIN_SHORT_EDGE, true, shortEdge.toDouble()),
            Check(CheckId.EXPOSURE, mean in LUMA_MIN..LUMA_MAX, true, mean),
            Check(CheckId.CLIPPING, clipShare <= CLIP_MAX, false, clipShare),
            Check(CheckId.CONTRAST, contrast >= CONTRAST_MIN, false, contrast),
            Check(CheckId.SHARPNESS, sharpness >= SHARP_SOFT, sharpness < SHARP_HARD, sharpness),
            Check(CheckId.FRAMING, framing >= FRAMING_MIN, false, framing),
        )
        val hardFail = checks.any { !it.passed && it.hard }
        val softFails = checks.count { !it.passed && !it.hard }
        val status = when { hardFail || softFails >= 3 -> Status.UNUSABLE; softFails > 0 -> Status.LIMITED; else -> Status.USABLE }
        return Result(status, mean, clipShare, contrast, sharpness, framing, checks, if (status == Status.USABLE) null else tip(checks, mean))
    }

    /** Patient-friendly, specific retake guidance (same wording as the server). */
    fun tip(checks: List<Check>, mean: Double): String {
        val failed = checks.filter { !it.passed }.map { it.id }.toSet()
        val tips = buildList {
            if (CheckId.EXPOSURE in failed) add(if (mean < LUMA_MIN) "Face a window or turn on a bright light" else "Move away from direct light or turn off the flash")
            if (CheckId.SHARPNESS in failed) add("Hold the phone steady with both hands and wait for the focus ring")
            if (CheckId.CLIPPING in failed) add("Tilt the phone slightly to avoid glare on the aligner")
            if (CheckId.FRAMING in failed) add("Fill the outline with your teeth and keep the retractor wide open")
            if (CheckId.RESOLUTION in failed) add("Use the in-app camera rather than a screenshot")
            if (CheckId.CONTRAST in failed) add("Wipe the camera lens and dry your teeth with a tissue")
        }
        return tips.joinToString(". ") + "."
    }

    /** Short live hint for the camera overlay (one thing at a time, most important first). */
    fun liveHint(r: Result): String? {
        val f = r.checks.firstOrNull { !it.passed && it.id != CheckId.RESOLUTION } ?: return null
        return when (f.id) {
            CheckId.EXPOSURE -> if (r.meanLuma < LUMA_MIN) "Too dark: find more light" else "Too bright: avoid direct light"
            CheckId.SHARPNESS -> "Hold still…"
            CheckId.CLIPPING -> "Glare: tilt the phone slightly"
            CheckId.FRAMING -> "Line your teeth up with the outline"
            CheckId.CONTRAST -> "Wipe the lens"
            CheckId.RESOLUTION -> null
        }
    }
}
