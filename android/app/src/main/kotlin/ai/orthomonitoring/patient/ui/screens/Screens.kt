@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ai.orthomonitoring.patient.ui.screens

import ai.orthomonitoring.core.Wear
import ai.orthomonitoring.patient.AppContainer
import ai.orthomonitoring.patient.data.*
import ai.orthomonitoring.patient.ui.components.*
import ai.orthomonitoring.patient.ui.theme.Oma
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Screen(title: String, onBack: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Scaffold(containerColor = Oma.Canvas, topBar = {
        TopAppBar(title = { Text(title, style = MaterialTheme.typography.headlineSmall) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = Oma.Canvas))
    }) { pad -> Column(Modifier.padding(pad).fillMaxSize(), content = content) }
}

// ── Report a problem (urgency triage) ───────────────────────────────────────
private val ISSUES = listOf(
    Triple("aligner_cracked", "Cracked or broken aligner", Icons.Outlined.BrokenImage), Triple("aligner_lost", "Lost aligner", Icons.Outlined.SearchOff),
    Triple("attachment_off", "Attachment came off", Icons.Outlined.Circle), Triple("poor_fit", "Aligner not fitting", Icons.Outlined.Compress),
    Triple("pain", "Pain or soreness", Icons.Outlined.Healing), Triple("irritation", "Sharp edge / irritation", Icons.Outlined.Warning),
    Triple("bracket_loose", "Loose bracket", Icons.Outlined.GridOff), Triple("wire_poking", "Poking or broken wire", Icons.Outlined.Straighten),
    Triple("other", "Something else", Icons.Outlined.HelpOutline),
)

@Composable
fun IssueScreen(c: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var category by remember { mutableStateOf<String?>(null) }
    var pain by remember { mutableFloatStateOf(0f) }
    var details by remember { mutableStateOf("") }
    var photos by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<IssueResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val uuid = remember { UUID.randomUUID().toString() }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(3)) { photos = it }
    Screen("Report a problem", onBack) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            result?.let { r ->
                val emergency = r.emergency
                OmaCard {
                    StatusChip(if (r.urgency == "P1" || r.urgency == "P2") "Clinic alerted" else "Sent to clinic", if (emergency) Tone.URGENT else Tone.STABLE)
                    Spacer(Modifier.height(10.dp))
                    Text("While you wait", style = MaterialTheme.typography.titleMedium)
                    Text(r.guidance, color = Oma.Ink2)
                    if (emergency) { Spacer(Modifier.height(10.dp)); Text("If you have trouble breathing or swallowing, or severe swelling, call emergency services now.", color = Oma.Urgent, fontWeight = FontWeight.SemiBold) }
                }
                PrimaryButton("Back to home") { onBack() }
                return@Column
            }
            Text("What happened?", style = MaterialTheme.typography.headlineMedium)
            ISSUES.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { (k, l, icon) ->
                        val on = category == k
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(16.dp)).background(if (on) Oma.Navy else Oma.Surface).clickable { category = k }.padding(12.dp).heightIn(min = 86.dp)) {
                            Icon(icon, null, tint = if (on) Oma.Amber else Oma.Navy); Spacer(Modifier.height(8.dp)); Text(l, color = if (on) Color.White else Oma.Ink, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
            Column { SectionLabel("Pain: ${pain.toInt()}/10"); Slider(pain, { pain = it }, valueRange = 0f..10f, steps = 9, colors = SliderDefaults.colors(thumbColor = Oma.Ember, activeTrackColor = Oma.Ember)) }
            OutlinedTextField(details, { details = it }, label = { Text("Tell us more") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.AddAPhoto, null); Spacer(Modifier.width(8.dp)); Text(if (photos.isEmpty()) "Add photos (optional)" else "${photos.size} photo(s) added")
            }
            error?.let { Text(it, color = Oma.Urgent) }
            PrimaryButton("Send report", enabled = category != null, loading = busy, color = Oma.Ember) {
                busy = true; error = null
                scope.launch {
                    try {
                        val bytes = photos.mapNotNull { u -> context.contentResolver.openInputStream(u)?.use { it.readBytes() } }
                        result = c.api.reportIssue(uuid, category!!, pain.toInt(), null, details, bytes)
                    } catch (e: Exception) { error = "Couldn't send. If this is urgent, please call the clinic." }
                    busy = false
                }
            }
            Text("For emergencies (trouble breathing or swallowing, heavy bleeding, severe swelling) call emergency services.", color = Oma.Ink3, fontSize = 12.sp)
        }
    }
}

// ── Secure chat ─────────────────────────────────────────────────────────────
@Composable
fun ChatScreen(c: AppContainer, onBack: () -> Unit) {
    var messages by remember { mutableStateOf<List<Message>>(emptyList()) }
    var text by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    LaunchedEffect(Unit) { while (true) { runCatching { c.api.messages() }.onSuccess { messages = it }; kotlinx.coroutines.delay(15_000) } }
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) list.animateScrollToItem(messages.size - 1) }
    Screen("Messages", onBack) {
        LazyColumn(Modifier.weight(1f).padding(horizontal = 16.dp), state = list, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(messages, key = { it.id }) { m ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (m.fromPatient) Arrangement.End else Arrangement.Start) {
                    Column(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp)).background(if (m.fromPatient) Oma.Navy else if (m.automated) Oma.Sunken else Oma.Surface).padding(12.dp)) {
                        if (!m.fromPatient) Text(m.senderName ?: "Clinic", fontSize = 11.sp, color = Oma.Ink3, fontWeight = FontWeight.SemiBold)
                        Text(m.body, color = if (m.fromPatient) Color.White else Oma.Ink)
                        Text(prettyDateTime(m.createdAt.take(16)), fontSize = 10.sp, color = if (m.fromPatient) Color.White.copy(alpha = 0.6f) else Oma.Ink3)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().background(Oma.Surface).imePadding().navigationBarsPadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(text, { text = it }, placeholder = { Text("Message your clinic") }, modifier = Modifier.weight(1f), maxLines = 4)
            IconButton(enabled = text.isNotBlank(), onClick = {
                val body = text; text = ""
                scope.launch { runCatching { c.api.sendMessage(body, UUID.randomUUID().toString()); messages = c.api.messages() }.onFailure { text = body } }
            }) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = Oma.Ember) }
        }
    }
}

// ── Wear-time log ────────────────────────────────────────────────────────────
@Composable
fun WearScreen(c: AppContainer, onBack: () -> Unit) {
    var home by remember { mutableStateOf<Home?>(null) }
    var hours by remember { mutableFloatStateOf(22f) }
    var day by remember { mutableStateOf(LocalDate.now()) }
    var saved by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(saved) { home = runCatching { c.api.home() }.getOrNull() }
    val target = home?.wear?.targetHours ?: 22.0
    val byDate = home?.wear?.week?.associate { it.date to it.hours } ?: emptyMap()
    val streak = Wear.streak((0..6).map { byDate[LocalDate.now().minusDays(it.toLong()).toString()] }, target)
    Screen("Wear time", onBack) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            OmaCard { SectionLabel("Streak"); Text("$streak day${if (streak == 1) "" else "s"} at ${target.toInt()}+ hours", style = MaterialTheme.typography.headlineSmall) }
            OmaCard {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom, modifier = Modifier.height(120.dp).fillMaxWidth()) {
                    (6 downTo 0).forEach { i ->
                        val d = LocalDate.now().minusDays(i.toLong()); val h = byDate[d.toString()]
                        Column(Modifier.weight(1f).clickable { day = d; hours = (h ?: 22.0).toFloat() }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                            Box(Modifier.fillMaxWidth().fillMaxHeight(((h ?: 0.0) / 24).toFloat().coerceIn(0.03f, 0.8f)).clip(RoundedCornerShape(6.dp)).background(if (h == null) Oma.Line else if (h >= target) Oma.Stable else Oma.Amber))
                            Text(d.dayOfWeek.name.take(1), fontSize = 11.sp, color = if (d == day) Oma.Ember else Oma.Ink3, fontWeight = if (d == day) FontWeight.Bold else FontWeight.Normal)
                        }
                    }
                }
            }
            Text("${if (day == LocalDate.now()) "Today" else prettyDate(day.toString())}: ${"%.1f".format(hours)} hours", style = MaterialTheme.typography.titleMedium)
            Slider(hours, { hours = (it * 2).toInt() / 2f }, valueRange = 0f..24f, colors = SliderDefaults.colors(thumbColor = Oma.Ember, activeTrackColor = Oma.Ember))
            PrimaryButton(if (saved) "Saved ✓" else "Save") { scope.launch { runCatching { c.api.logWear(day.toString(), hours.toDouble()) }.onSuccess { saved = !saved } } }
        }
    }
}

// ── Clinic-approved education ────────────────────────────────────────────────
@Composable
fun LearnScreen(c: AppContainer, onBack: () -> Unit) {
    var items by remember { mutableStateOf<List<Education>>(emptyList()) }
    var open by remember { mutableStateOf<Education?>(null) }
    LaunchedEffect(Unit) { items = runCatching { c.api.education() }.getOrDefault(emptyList()) }
    Screen(open?.title ?: "Learn", { if (open != null) open = null else onBack() }) {
        open?.let { e ->
            Column(Modifier.verticalScroll(rememberScrollState()).padding(22.dp)) {
                Text("${e.category.uppercase()} · ${e.readMinutes} MIN", style = MaterialTheme.typography.labelSmall, color = Oma.Ink3)
                Spacer(Modifier.height(12.dp))
                e.body.lines().forEach { line ->
                    when {
                        line.startsWith("## ") -> Text(line.removePrefix("## "), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 14.dp, bottom = 4.dp))
                        line.startsWith("- ") -> Text("•  " + line.removePrefix("- "), modifier = Modifier.padding(vertical = 2.dp))
                        line.isNotBlank() -> Text(line, modifier = Modifier.padding(vertical = 4.dp))
                    }
                }
                Spacer(Modifier.height(18.dp)); Text("Approved by ${e.approvedBy ?: "your clinic"}", color = Oma.Ink3, fontSize = 12.sp)
            }
            return@Screen
        }
        LazyColumn(Modifier.padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(items) { e -> OmaCard(onClick = { open = e }) { Text("${e.category.uppercase()} · ${e.readMinutes} MIN", style = MaterialTheme.typography.labelSmall, color = Oma.Ink3); Text(e.title, style = MaterialTheme.typography.headlineSmall); e.summary?.let { Text(it, color = Oma.Ink3) } } }
        }
    }
}

// ── Progress (clinic-reviewed images only) ───────────────────────────────────
@Composable
fun ProgressScreen(c: AppContainer, onBack: () -> Unit) {
    var p by remember { mutableStateOf<Progress?>(null) }
    LaunchedEffect(Unit) { p = runCatching { c.api.progress() }.getOrNull() }
    Screen("My progress", onBack) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf("Start" to p?.first, "Now" to p?.latest).forEach { (label, pt) ->
                    Column(Modifier.weight(1f)) {
                        Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(RoundedCornerShape(16.dp)).background(Oma.Navy)) {
                            pt?.imageId?.let { AsyncImage(model = c.api.imageUrl(it), contentDescription = label, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                        }
                        Text("$label${pt?.stage?.let { " · aligner $it" } ?: ""}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
                        Text(prettyDate(pt?.date), color = Oma.Ink3, fontSize = 12.sp)
                    }
                }
            }
            Text("Photos appear here after your orthodontist has reviewed them.", color = Oma.Ink3, fontSize = 13.sp)
            SectionLabel("Aligner timeline")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                p?.timeline?.forEach { s ->
                    Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(when (s.status) { "completed" -> Oma.Navy; "active" -> Oma.Ember; "held" -> Oma.Amber; else -> Oma.Line }), contentAlignment = Alignment.Center) {
                        Text("${s.stage}", color = if (s.status == "upcoming") Oma.Ink3 else Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
fun AppointmentsScreen(c: AppContainer, onBack: () -> Unit) {
    var items by remember { mutableStateOf<List<Appointment>>(emptyList()) }
    LaunchedEffect(Unit) { items = runCatching { c.api.appointments() }.getOrDefault(emptyList()) }
    Screen("Appointments", onBack) {
        LazyColumn(Modifier.padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(items) { a -> OmaCard { Text(prettyDateTime(a.startAt), style = MaterialTheme.typography.titleMedium); Text("${a.type} · ${a.durationMin} min", color = Oma.Ink2); a.doctor?.let { Text(it, color = Oma.Ink3) }; a.branch?.let { Text("$it${a.address?.let { ad -> " · $ad" } ?: ""}", color = Oma.Ink3, fontSize = 13.sp) }; Spacer(Modifier.height(6.dp)); StatusChip(a.status, when (a.status) { "booked" -> Tone.INFO; "completed" -> Tone.STABLE; "requested" -> Tone.ATTENTION; else -> Tone.NEUTRAL }) } }
            if (items.isEmpty()) item { Text("No appointments yet.", color = Oma.Ink3) }
        }
    }
}

@Composable
fun SettingsScreen(c: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var voice by remember { mutableStateOf(c.session.voiceGuidance) }
    var reminders by remember { mutableStateOf(c.session.reminders) }
    var auto by remember { mutableStateOf(c.session.autoCapture) }
    Screen("Settings", onBack) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OmaCard {
                SettingRow("Voice guidance", "Spoken instructions while taking photos", voice) { voice = it; c.session.voiceGuidance = it }
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Oma.Line)
                SettingRow("Auto-capture", "Take the photo automatically when it's sharp and well lit", auto) { auto = it; c.session.autoCapture = it }
                HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Oma.Line)
                SettingRow("Check-in reminders", "Evening reminder when a check-in is due", reminders) { reminders = it; c.session.reminders = it }
            }
            OmaCard {
                SectionLabel("Privacy")
                Text("Photos are encrypted on this phone until they upload, then deleted from the phone. Screenshots of this app are blocked. Only your clinic team can see your photos. Your orthodontist makes every treatment decision.", color = Oma.Ink2)
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://orthomonitoring.ai/privacy"))) }) { Text("Privacy notice") }
            }
            OutlinedButton(onClick = { scope.launch { c.api.logout(); c.queue.clear(); c.session.signOut() } }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Sign out of this device", color = Oma.Urgent) }
        }
    }
}

@Composable
private fun SettingRow(title: String, sub: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.SemiBold); Text(sub, color = Oma.Ink3, fontSize = 13.sp) }
        Switch(value, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Oma.Ember))
    }
}
