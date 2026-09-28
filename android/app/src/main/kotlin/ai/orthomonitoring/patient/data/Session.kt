package ai.orthomonitoring.patient.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Patient session: an opaque, single-patient token stored in EncryptedSharedPreferences (Android Keystore).
 * The app never holds AI provider keys or talks to AI providers: it only calls the clinic API.
 */
class Session(context: Context) {
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context, "oma_session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val _token = MutableStateFlow(prefs.getString(KEY_TOKEN, null))
    val token: StateFlow<String?> = _token

    var firstName: String? get() = prefs.getString(KEY_NAME, null); set(v) = prefs.edit().putString(KEY_NAME, v).apply()
    var voiceGuidance: Boolean get() = prefs.getBoolean(KEY_VOICE, true); set(v) = prefs.edit().putBoolean(KEY_VOICE, v).apply()
    var reminders: Boolean get() = prefs.getBoolean(KEY_REMINDERS, true); set(v) = prefs.edit().putBoolean(KEY_REMINDERS, v).apply()
    var autoCapture: Boolean get() = prefs.getBoolean(KEY_AUTO, true); set(v) = prefs.edit().putBoolean(KEY_AUTO, v).apply()

    fun signIn(token: String, name: String) { prefs.edit().putString(KEY_TOKEN, token).putString(KEY_NAME, name).apply(); _token.value = token }
    fun signOut() { prefs.edit().clear().apply(); _token.value = null }

    private companion object {
        const val KEY_TOKEN = "token"; const val KEY_NAME = "first_name"; const val KEY_VOICE = "voice"; const val KEY_REMINDERS = "reminders"; const val KEY_AUTO = "auto_capture"
    }
}
