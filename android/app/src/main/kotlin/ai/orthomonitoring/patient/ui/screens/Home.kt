package ai.orthomonitoring.patient.ui.screens

import ai.orthomonitoring.core.CheckinStatus
import ai.orthomonitoring.patient.AppContainer
import ai.orthomonitoring.patient.data.Home
import ai.orthomonitoring.patient.ui.components.*
import ai.orthomonitoring.patient.ui.theme.Oma
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

private val dayFmt = DateTimeFormatter.ofPattern("EEE d MMM")
fun prettyDate(iso: String?): String = runCatching { LocalDate.parse(iso!!.take(10)).format(dayFmt) }.getOrDefault("—")
fun prettyDateTime(iso: String): String = runCatching { LocalDateTime.parse(iso.take(16)).format(DateTimeFormatter.ofPattern("EEE d MMM · HH:mm")) }.getOrDefault(iso)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(c: AppContainer, onStartCheckin: (retakeOf: String?, views: List<String>?) -> Unit, go: (String) -> Unit) {
    var home by remember { mutableStateOf<Home?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val queue by c.queue.items.collectAsState()
    val online by c.connectivity.online.collectAsState()
    val notif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33) notif.launch(Manifest.permission.POST_NOTIFICATIONS) }
    suspend fun load() { runCatching { c.api.home() }.onSuccess { home = it; error = null }.onFailure { error = if (home == null) "You're offline. Showing what's saved on this phone." else null } }
    LaunchedEffect(queue.count { it.submitted }) { load() }

    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            val h = home
            val accent = Oma.accent(h?.clinic?.branding?.accent)
            // Header
            Column(Modifier.fillMaxWidth().background(Oma.Navy).statusBarsPadding().padding(start = 22.dp, end = 22.dp, top = 16.dp, bottom = 72.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(accent), contentAlignment = Alignment.Center) {
                        Text(h?.clinic?.branding?.logoText ?: "", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(h?.clinic?.branding?.displayName ?: h?.clinic?.name ?: "", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    IconButton(onClick = { go("chat") }) {
                        BadgedBox(badge = { if ((h?.unreadMessages ?: 0) > 0) Badge(containerColor = Oma.Ember) { Text("${h!!.unreadMessages}") } }) { Icon(Icons.Outlined.ChatBubbleOutline, "Messages", tint = Color.White) }
                    }
                    IconButton(onClick = { go("settings") }) { Icon(Icons.Outlined.Settings, "Settings", tint = Color.White) }
                }
                Spacer(Modifier.height(22.dp))
                Text("Hi ${c.session.firstName ?: ""}", color = Color.White.copy(alpha = 0.7f))
                Text(h?.stage?.let { "Aligner ${it.current} of ${it.total}" } ?: "Your treatment", style = MaterialTheme.typography.displaySmall.copy(color = Color.White))
                if (!online) { Spacer(Modifier.height(8.dp)); StatusChip("Offline · check-ins will upload automatically", Tone.ATTENTION) }
            }
            Column(Modifier.offset(y = (-56).dp).padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Today's action
                h?.action?.let { a ->
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(if (a.kind == "retake") Oma.Attention else accent).padding(22.dp)) {
                        Text("TODAY", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
                        Text(a.title, color = Color.White, style = MaterialTheme.typography.headlineSmall.copy(color = Color.White))
                        Text(a.detail, color = Color.White.copy(alpha = 0.85f))
                        if (a.kind == "checkin" || a.kind == "retake") {
                            Spacer(Modifier.height(16.dp))
                            Button(onClick = { onStartCheckin(if (a.kind == "retake") a.checkinId else null, a.views) }, modifier = Modifier.fillMaxWidth().height(52.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = accent), shape = RoundedCornerShape(14.dp)) {
                                Icon(Icons.Outlined.PhotoCamera, null); Spacer(Modifier.width(8.dp)); Text(if (a.kind == "retake") "Retake photos" else "Start check-in", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
                error?.let { OmaCard { Text(it, color = Oma.Ink2) } }

                // Local outbox (uploading / waiting for connection)
                queue.filter { !it.submitted }.forEach { q ->
                    val l = CheckinStatus.local(q, online)
                    OmaCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text("Check-in ${prettyDate(q.createdAt)}", fontWeight = FontWeight.SemiBold); Text(l.detail, color = Oma.Ink3, fontSize = 13.sp) }
                            StatusChip(l.title, if (l.tone == CheckinStatus.Tone.ATTENTION) Tone.ATTENTION else Tone.INFO)
                        }
                        Spacer(Modifier.height(10.dp)); LinearProgressIndicator(progress = { q.progress }, Modifier.fillMaxWidth().clip(CircleShape), color = Oma.Ember, trackColor = Oma.Sunken)
                    }
                }

                // Stage + dates
                h?.stage?.let { s ->
                    OmaCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StageRing(s.current, s.total)
                            Spacer(Modifier.width(18.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Fact("Day on this aligner", "${s.daysOn} of ${s.stageDays}")
                                Fact(if (s.held) "Change (held by your orthodontist)" else "Next planned change", prettyDate(s.nextChange))
                                Fact("Next check-in", prettyDate(h.nextCheckin.date))
                            }
                        }
                    }
                }
                h?.appointment?.let { ap ->
                    OmaCard(onClick = { go("appointments") }) {
                        SectionLabel("Next appointment")
                        Text(prettyDateTime(ap.startAt), style = MaterialTheme.typography.titleMedium)
                        Text("${ap.type} · ${ap.durationMin} min${ap.doctor?.let { " · $it" } ?: ""}", color = Oma.Ink3)
                        if (ap.status == "requested") { Spacer(Modifier.height(6.dp)); StatusChip("The clinic will confirm the time", Tone.INFO) }
                        ap.address?.let { Text(it, color = Oma.Ink3, fontSize = 13.sp) }
                    }
                }
                h?.wear?.let { w ->
                    OmaCard(onClick = { go("wear") }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { SectionLabel("Wear time"); Text(w.todayHours?.let { "${it} h today" } ?: "Log today's hours", style = MaterialTheme.typography.titleMedium) }
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom, modifier = Modifier.height(44.dp)) {
                                w.week.forEach { d -> Box(Modifier.width(8.dp).fillMaxHeight((d.hours / 24).toFloat().coerceIn(0.05f, 1f)).clip(RoundedCornerShape(3.dp)).background(if (d.hours >= w.targetHours) Oma.Stable else Oma.Amber)) }
                            }
                        }
                    }
                }

                // Quick actions
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    QuickAction(Icons.Outlined.ReportProblem, "Report a problem", Modifier.weight(1f)) { go("issue") }
                    QuickAction(Icons.Outlined.AutoGraph, "My progress", Modifier.weight(1f)) { go("progress") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    QuickAction(Icons.Outlined.MenuBook, "Learn", Modifier.weight(1f)) { go("learn") }
                    QuickAction(Icons.Outlined.Event, "Appointments", Modifier.weight(1f)) { go("appointments") }
                }

                h?.openIssue?.let { OmaCard { SectionLabel("Your report"); Text(it.category ?: "Report", fontWeight = FontWeight.SemiBold); Text("Status: ${it.status}. The clinic team is on it.", color = Oma.Ink3) } }

                if (!h?.checkins.isNullOrEmpty()) {
                    SectionLabel("Check-in history")
                    h!!.checkins.forEach { ck ->
                        val label = CheckinStatus.server(ck.status)
                        OmaCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) { Text(prettyDate(ck.submittedAt ?: ck.createdAt), fontWeight = FontWeight.SemiBold); Text(ck.stageNo?.let { "Aligner $it" } ?: "", color = Oma.Ink3, fontSize = 13.sp) }
                                StatusChip(label.title, toneOf(ck.tone))
                            }
                            ck.feedback?.let { Spacer(Modifier.height(10.dp)); Text(it, color = Oma.Ink2, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Oma.Sunken).padding(12.dp)) }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable private fun Fact(label: String, value: String) = Column { Text(label, color = Oma.Ink3, fontSize = 12.sp); Text(value, fontWeight = FontWeight.SemiBold) }

@Composable
private fun QuickAction(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(20.dp)).background(Oma.Surface).clickable(onClick = onClick).padding(18.dp)) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Oma.Sunken), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Oma.Navy) }
        Spacer(Modifier.height(12.dp)); Text(label, fontWeight = FontWeight.SemiBold)
    }
}
