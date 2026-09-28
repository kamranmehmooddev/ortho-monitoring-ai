@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ai.orthomonitoring.patient.ui.screens

import ai.orthomonitoring.core.CaptureGuide
import ai.orthomonitoring.core.CaptureView
import ai.orthomonitoring.core.CheckinStatus
import ai.orthomonitoring.core.Quality
import ai.orthomonitoring.core.QueuedCheckin
import ai.orthomonitoring.patient.AppContainer
import ai.orthomonitoring.patient.camera.CaptureStepScreen
import ai.orthomonitoring.patient.camera.CapturedPhoto
import ai.orthomonitoring.patient.queue.UploadWorker
import ai.orthomonitoring.patient.ui.components.*
import ai.orthomonitoring.patient.ui.theme.Oma
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID

private enum class Phase { PREFLIGHT, CAPTURE, REVIEW, SENT }

/** Guided check-in: quick questions → guided photos → review → encrypted outbox. Target: under 3 minutes. */
@Composable
fun CheckinFlow(c: AppContainer, retakeOf: String?, retakeViews: List<String>?, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var home by remember { mutableStateOf<ai.orthomonitoring.patient.data.Home?>(null) }
    LaunchedEffect(Unit) { home = runCatching { c.api.home() }.getOrNull() }
    val required = home?.requiredViews ?: CaptureView.entries.map { ai.orthomonitoring.patient.data.RequiredView(it.apiName, it != CaptureView.UPPER && it != CaptureView.LOWER) }
    val steps = remember(home, retakeViews) {
        val pairs = required.map { CaptureView.from(it.view) to it.withAligner }.filter { retakeViews == null || it.first.apiName in retakeViews }
        CaptureGuide.steps(pairs.ifEmpty { retakeViews.orEmpty().map { CaptureView.from(it) to true } })
    }
    var phase by remember { mutableStateOf(if (retakeOf != null) Phase.CAPTURE else Phase.PREFLIGHT) }
    var stepIndex by remember { mutableIntStateOf(0) }
    val photos = remember { mutableStateMapOf<String, CapturedPhoto>() }
    var voiceOn by remember { mutableStateOf(c.session.voiceGuidance) }
    val uuid = remember { UUID.randomUUID().toString() }
    var aligner by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(home) { if (aligner == null) aligner = home?.stage?.current }
    var wear by remember { mutableStateOf<String?>(null) }
    var fit by remember { mutableStateOf<String?>(null) }
    val symptoms = remember { mutableStateListOf<String>() }
    var pain by remember { mutableFloatStateOf(0f) }
    var concerns by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    when (phase) {
        Phase.PREFLIGHT -> Column(Modifier.fillMaxSize().background(Oma.Canvas).verticalScroll(rememberScrollState()).systemBarsPadding().padding(22.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onDone) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text("Step 1 of 3 · Quick questions", color = Oma.Ink3) }
            Text("How's your aligner?", style = MaterialTheme.typography.headlineMedium)
            Column { SectionLabel("Aligner you're wearing now")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { aligner = ((aligner ?: 1) - 1).coerceAtLeast(1) }) { Text("–") }
                    Text("#${aligner ?: "?"}", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(horizontal = 20.dp))
                    OutlinedButton(onClick = { aligner = (aligner ?: 0) + 1 }) { Text("+") }
                }
                if (home?.stage != null && aligner != home?.stage?.current) Text("Your plan says aligner ${home?.stage?.current}. That's okay; tell us what you're actually wearing.", color = Oma.Attention, fontSize = 13.sp)
            }
            Column { SectionLabel("Hours worn per day this week"); ChoiceChips(listOf("<16" to "Under 16", "16-20" to "16–20", "20-22" to "20–22", "22+" to "22+"), wear) { wear = it } }
            Column { SectionLabel("How does it fit?"); ChoiceChips(listOf("good" to "Snug, fully clicked in", "poor" to "Loose or gaps", "unsure" to "Not sure"), fit) { fit = it } }
            Column { SectionLabel("Anything else? (tap all that apply)")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("soreness" to "Soreness", "sharp_edge" to "Sharp edge", "tight" to "Very tight", "gum_irritation" to "Gum irritation", "attachment_rough" to "Rough attachment").forEach { (k, l) ->
                        FilterChip(selected = k in symptoms, onClick = { if (k in symptoms) symptoms.remove(k) else symptoms.add(k) }, label = { Text(l) })
                    }
                }
            }
            Column { SectionLabel("Pain right now: ${pain.toInt()}/10"); Slider(pain, { pain = it }, valueRange = 0f..10f, steps = 9, colors = SliderDefaults.colors(thumbColor = Oma.Ember, activeTrackColor = Oma.Ember))
                if (pain >= 8) Text("Severe pain? Use \"Report a problem\" after this so the clinic is alerted right away.", color = Oma.Urgent, fontSize = 13.sp) }
            OutlinedTextField(concerns, { concerns = it }, label = { Text("Questions or concerns (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
            PrimaryButton("Continue to photos · ${steps.size}", enabled = wear != null && fit != null) { phase = Phase.CAPTURE }
        }

        Phase.CAPTURE -> {
            val step = steps.getOrNull(stepIndex)
            LaunchedEffect(step) { if (step == null) phase = Phase.REVIEW }
            if (step != null) CaptureStepScreen(step, stepIndex, steps.size, voiceOn, c.session.autoCapture, onToggleVoice = { voiceOn = !voiceOn; c.session.voiceGuidance = voiceOn },
                onCaptured = { p -> photos[step.key] = p; val next = steps.indexOfFirst { it.key !in photos }; if (next == -1) phase = Phase.REVIEW else stepIndex = next },
                onClose = { if (photos.isEmpty() && retakeOf == null) phase = Phase.PREFLIGHT else if (photos.isEmpty()) onDone() else phase = Phase.REVIEW })
        }

        Phase.REVIEW -> Column(Modifier.fillMaxSize().background(Oma.Canvas).systemBarsPadding().padding(22.dp)) {
            Text("Step 3 of 3 · Review", color = Oma.Ink3)
            Text("Your photos", style = MaterialTheme.typography.headlineMedium)
            Text("Tap a photo to retake it. They're encrypted on this phone until they upload.", color = Oma.Ink3)
            Spacer(Modifier.height(16.dp))
            LazyVerticalGrid(GridCells.Fixed(2), Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(steps) { s ->
                    val p = photos[s.key]
                    Column(Modifier.clip(RoundedCornerShape(16.dp)).background(Oma.Surface).clickable { stepIndex = steps.indexOf(s); phase = Phase.CAPTURE }) {
                        Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).background(Oma.Navy)) {
                            if (p != null) Image(p.preview.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            else Text("Tap to capture", color = Color.White, modifier = Modifier.align(Alignment.Center))
                        }
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(s.title + if (s.withAligner) "" else " · out", fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.weight(1f))
                            p?.let { StatusChip(when (it.quality.status) { Quality.Status.USABLE -> "Clear"; Quality.Status.LIMITED -> "OK"; Quality.Status.UNUSABLE -> "Retake" },
                                when (it.quality.status) { Quality.Status.USABLE -> Tone.STABLE; Quality.Status.LIMITED -> Tone.ATTENTION; Quality.Status.UNUSABLE -> Tone.URGENT }) }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            PrimaryButton("Send to my orthodontist", enabled = photos.size == steps.size, loading = saving, color = Oma.Ember) {
                saving = true
                scope.launch {
                    val staged = steps.mapNotNull { s -> photos[s.key]?.let { c.queue.stagePhoto(uuid, s.view, s.withAligner, it.jpeg, it.override) } }
                    c.queue.enqueue(QueuedCheckin(uuid, Instant.now().toString(), aligner, wear, fit, symptoms.toList(), pain.toInt(), concerns.ifBlank { null }, staged, retakeOf = retakeOf))
                    UploadWorker.schedule(context)
                    saving = false; phase = Phase.SENT
                }
            }
        }

        Phase.SENT -> {
            val q by c.queue.items.collectAsState()
            val online by c.connectivity.online.collectAsState()
            val item = q.firstOrNull { it.clientUuid == uuid }
            val label = item?.let { CheckinStatus.local(it, online) }
            Column(Modifier.fillMaxSize().background(Oma.Navy).systemBarsPadding().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(if (item?.submitted == true) Icons.Filled.CheckCircle else Icons.Filled.CloudUpload, null, tint = Oma.Amber, modifier = Modifier.size(72.dp))
                Spacer(Modifier.height(20.dp))
                Text(if (item?.submitted == true) "Sent to your clinic" else label?.title ?: "Saving…", style = MaterialTheme.typography.headlineMedium.copy(color = Color.White))
                Spacer(Modifier.height(8.dp))
                Text(if (item?.submitted == true) "Keep wearing your current aligner until your orthodontist replies. We'll notify you." else label?.detail ?: "",
                    color = Color.White.copy(alpha = 0.75f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Spacer(Modifier.height(24.dp))
                LinearProgressIndicator(progress = { if (item?.submitted == true) 1f else item?.progress ?: 0f }, Modifier.fillMaxWidth().height(8.dp).clip(CircleShape), color = Oma.Amber, trackColor = Color.White.copy(alpha = 0.15f))
                Spacer(Modifier.height(32.dp))
                PrimaryButton("Done", color = Oma.Ember) { onDone() }
            }
        }
    }
}
