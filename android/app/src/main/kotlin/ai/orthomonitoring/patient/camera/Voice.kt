package ai.orthomonitoring.patient.camera

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Spoken capture guidance (can be muted in Settings). */
class Voice(context: Context, private val enabled: () -> Boolean) {
    private var ready = false
    private val tts = TextToSpeech(context.applicationContext) { status -> ready = status == TextToSpeech.SUCCESS }.apply { language = Locale.getDefault(); setSpeechRate(0.95f) }
    private var last: String? = null
    fun say(text: String, force: Boolean = false) {
        if (!enabled() || !ready || (!force && text == last)) return
        last = text
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, text.hashCode().toString())
    }
    fun shutdown() = tts.shutdown()
}
