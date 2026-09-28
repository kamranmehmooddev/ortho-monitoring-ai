package ai.orthomonitoring.core

enum class CaptureView(val apiName: String, val label: String) {
    FRONT("front", "Front bite"), LEFT("left", "Left bite"), RIGHT("right", "Right bite"), UPPER("upper", "Upper arch"), LOWER("lower", "Lower arch");
    companion object { fun from(api: String) = entries.first { it.apiName == api } }
}

enum class OverlayShape { BITE_FRONT, BITE_LEFT, BITE_RIGHT, ARCH_UPPER, ARCH_LOWER }

data class CaptureStep(
    val view: CaptureView, val withAligner: Boolean, val title: String, val instruction: String,
    val voice: String, val overlay: OverlayShape, val tips: List<String>,
) { val key get() = "${view.apiName}:${if (withAligner) "in" else "out"}" }

/** Builds the guided capture sequence from the clinic protocol's required views. */
object CaptureGuide {
    private val order = listOf(CaptureView.FRONT, CaptureView.RIGHT, CaptureView.LEFT, CaptureView.UPPER, CaptureView.LOWER)

    fun steps(required: List<Pair<CaptureView, Boolean>>): List<CaptureStep> =
        required.distinct().sortedWith(compareBy({ order.indexOf(it.first) }, { !it.second })).map { (v, aligner) -> step(v, aligner) }

    fun step(v: CaptureView, aligner: Boolean): CaptureStep {
        val a = if (aligner) "with your aligners in" else "with your aligners out"
        return when (v) {
            CaptureView.FRONT -> CaptureStep(v, aligner, "Front bite", "Retractor in, bite together on your back teeth, $a. Hold the phone straight in front of your mouth.",
                "Front bite, $a. Put in your retractor and bite together on your back teeth. Keep the phone level with your mouth.", OverlayShape.BITE_FRONT,
                listOf("Lips pulled back so gums show", "Phone level, not tilted", "Teeth fill the outline"))
            CaptureView.RIGHT -> CaptureStep(v, aligner, "Right bite", "Bite together, turn your head slightly left and pull the right cheek back, $a.",
                "Right side. Bite together, turn your head a little to the left and pull your right cheek back.", OverlayShape.BITE_RIGHT,
                listOf("Back molars visible", "Stretch the right retractor side"))
            CaptureView.LEFT -> CaptureStep(v, aligner, "Left bite", "Bite together, turn your head slightly right and pull the left cheek back, $a.",
                "Left side. Bite together, turn your head a little to the right and pull your left cheek back.", OverlayShape.BITE_LEFT,
                listOf("Back molars visible", "Stretch the left retractor side"))
            CaptureView.UPPER -> CaptureStep(v, aligner, "Upper arch", "Tilt your head back, open wide and use the mirror to show all upper teeth, $a.",
                "Upper arch. Tilt your head back, open wide, and angle the mirror so every upper tooth is inside the arch outline.", OverlayShape.ARCH_UPPER,
                listOf("Use the occlusal mirror", "Breathe through your nose to avoid fog"))
            CaptureView.LOWER -> CaptureStep(v, aligner, "Lower arch", "Chin down, open wide, tongue back and use the mirror to show all lower teeth, $a.",
                "Lower arch. Tuck your chin, open wide, move your tongue back and show every lower tooth in the outline.", OverlayShape.ARCH_LOWER,
                listOf("Tongue behind the teeth", "Dry the mirror first"))
        }
    }

    /** Patients may capture anyway after this long if the live checks never go green; the photo is flagged. */
    const val OVERRIDE_AFTER_MS = 8_000L
    /** Frames the live checks must stay green before auto-capture (stability). */
    const val STABLE_FRAMES = 6
}
