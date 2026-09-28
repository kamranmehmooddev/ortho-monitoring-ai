package ai.orthomonitoring.patient.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class ActivateRequest(val clinicCode: String, val activationCode: String, val deviceName: String)
@Serializable data class ActivateResponse(val token: String, val patientId: String, val firstName: String)

@Serializable data class Branding(val accent: String? = null, val displayName: String? = null, val logoText: String? = null, val patientWelcome: String? = null)
@Serializable data class Clinic(val name: String, val branding: Branding = Branding())
@Serializable data class PatientInfo(val firstName: String, val mode: String, val consent: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap())
@Serializable data class TodayAction(val kind: String, val title: String, val detail: String, val checkinId: String? = null, val views: List<String>? = null)
@Serializable data class StageInfo(val current: Int, val total: Int, val daysOn: Int, val stageDays: Int, val nextChange: String? = null, val held: Boolean = false)
@Serializable data class NextCheckin(val date: String, val reasons: List<String> = emptyList())
@Serializable data class Appointment(val id: String, val startAt: String, val durationMin: Int, val type: String, val status: String, val branch: String? = null, val address: String? = null, val doctor: String? = null)
@Serializable data class RequiredView(val view: String, @SerialName("with_aligner") val withAligner: Boolean)
@Serializable data class CheckinSummary(val id: String, val clientUuid: String? = null, val status: String, val label: String? = null, val tone: String? = null, val detail: String? = null,
                                        val stageNo: Int? = null, val createdAt: String, val submittedAt: String? = null, val feedback: String? = null)
@Serializable data class OpenIssue(val id: String, val category: String? = null, val status: String, val createdAt: String)
@Serializable data class WearDay(val date: String, val hours: Double)
@Serializable data class WearSummary(val week: List<WearDay> = emptyList(), val todayHours: Double? = null, val targetHours: Double = 22.0)
@Serializable data class Home(
    val clinic: Clinic, val patient: PatientInfo, val action: TodayAction, val stage: StageInfo? = null, val nextCheckin: NextCheckin,
    val appointment: Appointment? = null, val requiredViews: List<RequiredView>, val checkins: List<CheckinSummary>, val openIssue: OpenIssue? = null,
    val unreadMessages: Int = 0, val wear: WearSummary = WearSummary(),
)

@Serializable data class CreateCheckin(val clientUuid: String, val reportedAligner: Int? = null, val wear: String? = null, val fit: String? = null,
                                       val symptoms: List<String> = emptyList(), val painLevel: Int = 0, val concerns: String? = null)
@Serializable data class Created(val id: String, val status: String? = null, val idempotent: Boolean = false)
@Serializable data class UploadedImage(val id: String, val qualityStatus: String? = null)
@Serializable data class SubmitResult(val status: String, val views: List<String> = emptyList())

@Serializable data class Message(val id: String, val fromPatient: Boolean, val senderName: String? = null, val body: String, val imageIds: List<String> = emptyList(), val automated: Boolean = false, val createdAt: String)
@Serializable data class SendMessage(val body: String, val clientUuid: String)
@Serializable data class IssueResult(val id: String, val urgency: String, val guidance: String, val emergency: Boolean = false)
@Serializable data class WearLog(val date: String, val hours: Double)
@Serializable data class Education(val id: String, val title: String, val summary: String? = null, val body: String, val category: String, val readMinutes: Int = 2, val approvedBy: String? = null)
@Serializable data class ProgressPoint(val imageId: String? = null, val date: String, val stage: Int? = null)
@Serializable data class StagePoint(val stage: Int, val status: String, val start: String, val change: String)
@Serializable data class Progress(val first: ProgressPoint? = null, val latest: ProgressPoint? = null, val timeline: List<StagePoint> = emptyList())
@Serializable data class ApiErrorBody(val error: ApiErrorDetail? = null)
@Serializable data class ApiErrorDetail(val code: String? = null, val message: String? = null)
