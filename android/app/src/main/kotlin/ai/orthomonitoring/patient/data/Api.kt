package ai.orthomonitoring.patient.data

import ai.orthomonitoring.patient.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int?, message: String, val code: String? = null) : IOException(message)

/** Thin client for the patient API (/api/v1/patient/…). All calls are HTTPS in production and carry the session token. */
class Api(private val session: Session) {
    val baseUrl: String = BuildConfig.API_BASE
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val t = session.token.value
            chain.proceed(if (t != null) chain.request().newBuilder().header("Authorization", "Bearer $t").build() else chain.request())
        }
        .build()
    private val jsonType = "application/json".toMediaType()

    private suspend fun call(req: Request): String = withContext(Dispatchers.IO) {
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val err = runCatching { json.decodeFromString<ApiErrorBody>(body).error }.getOrNull()
                if (res.code == 401 && session.token.value != null && req.url.encodedPath.endsWith("/activate").not()) session.signOut()
                throw ApiException(res.code, err?.message ?: "Request failed (${res.code})", err?.code)
            }
            body
        }
    }
    private fun url(path: String) = baseUrl.trimEnd('/') + "/patient/" + path.trimStart('/')
    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call(Request.Builder().url(url(path)).get().build()))
    private suspend inline fun <reified B, reified T> post(path: String, body: B): T =
        json.decodeFromString(call(Request.Builder().url(url(path)).post(json.encodeToString(body).toRequestBody(jsonType)).build()))
    private suspend inline fun <reified T> postRaw(path: String, body: RequestBody): T = json.decodeFromString(call(Request.Builder().url(url(path)).post(body).build()))

    suspend fun activate(clinicCode: String, code: String): ActivateResponse = post("activate", ActivateRequest(clinicCode, code, android.os.Build.MODEL ?: "android"))
    suspend fun home(): Home = get("home")
    suspend fun createCheckin(b: CreateCheckin): Created = post("checkins", b)
    suspend fun uploadImage(checkinId: String, bytes: ByteArray, view: String, withAligner: Boolean, override: Boolean, capturedAt: String): UploadedImage =
        postRaw("checkins/$checkinId/images", MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("view", view).addFormDataPart("withAligner", withAligner.toString())
            .addFormDataPart("patientOverride", override.toString()).addFormDataPart("capturedAt", capturedAt)
            .addFormDataPart("image", "$view.jpg", bytes.toRequestBody("image/jpeg".toMediaType())).build())
    suspend fun submit(checkinId: String): SubmitResult = postRaw("checkins/$checkinId/submit", ByteArray(0).toRequestBody(jsonType))
    suspend fun messages(): List<Message> = get("messages")
    suspend fun sendMessage(body: String, clientUuid: String): Created = post("messages", SendMessage(body, clientUuid))
    suspend fun reportIssue(clientUuid: String, category: String, pain: Int, severity: Int?, details: String?, photos: List<ByteArray>): IssueResult {
        val mb = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("clientUuid", clientUuid).addFormDataPart("category", category).addFormDataPart("painLevel", pain.toString())
        severity?.let { mb.addFormDataPart("severity", it.toString()) }
        details?.takeIf { it.isNotBlank() }?.let { mb.addFormDataPart("details", it) }
        photos.forEachIndexed { i, p -> mb.addFormDataPart("photos", "issue$i.jpg", p.toRequestBody("image/jpeg".toMediaType())) }
        return postRaw("issues", mb.build())
    }
    suspend fun logWear(date: String, hours: Double) { call(Request.Builder().url(url("wear")).post(json.encodeToString(WearLog(date, hours)).toRequestBody(jsonType)).build()) }
    suspend fun education(): List<Education> = get("education")
    suspend fun progress(): Progress = get("progress")
    suspend fun appointments(): List<Appointment> = get("appointments")
    suspend fun logout() { runCatching { call(Request.Builder().url(url("logout")).post(ByteArray(0).toRequestBody(jsonType)).build()) } }
    fun imageUrl(id: String) = baseUrl.trimEnd('/') + "/images/$id"
}
