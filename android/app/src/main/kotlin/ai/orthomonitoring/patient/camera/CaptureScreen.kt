package ai.orthomonitoring.patient.camera

import ai.orthomonitoring.core.CaptureGuide
import ai.orthomonitoring.core.CaptureStep
import ai.orthomonitoring.core.Quality
import ai.orthomonitoring.patient.ui.theme.Oma
import android.Manifest
import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.math.max

data class CapturedPhoto(val step: CaptureStep, val jpeg: ByteArray, val preview: Bitmap, val quality: Quality.Result, val override: Boolean)

/**
 * Guided capture of one view: framing overlay, voice prompt, live light/blur/framing checks, stable-frame auto-capture,
 * post-capture verification at full resolution and a specific retake tip. Landscape is forced while capturing.
 */
@Composable
fun CaptureStepScreen(step: CaptureStep, index: Int, total: Int, voiceOn: Boolean, autoCapture: Boolean, onToggleVoice: () -> Unit,
                      onCaptured: (CapturedPhoto) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }
    DisposableEffect(Unit) {
        val act = context as? Activity
        val prev = act?.requestedOrientation
        act?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose { act?.requestedOrientation = prev ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
    val voice = remember { Voice(context) { voiceOn } }
    DisposableEffect(Unit) { onDispose { voice.shutdown() } }
    LaunchedEffect(step.key, voiceOn) { voice.say(step.voice, force = true) }

    var live by remember(step.key) { mutableStateOf<Quality.Result?>(null) }
    var stable by remember(step.key) { mutableIntStateOf(0) }
    var torch by remember { mutableStateOf(false) }
    var busy by remember(step.key) { mutableStateOf(false) }
    var review by remember(step.key) { mutableStateOf<CapturedPhoto?>(null) }
    val started = remember(step.key) { System.currentTimeMillis() }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(step.key) { while (true) { kotlinx.coroutines.delay(500); now = System.currentTimeMillis() } }
    val overrideAllowed = now - started > CaptureGuide.OVERRIDE_AFTER_MS

    val capture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
        .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY).build()).build() }
    var cameraControl by remember { mutableStateOf<androidx.camera.core.CameraControl?>(null) }
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) { onDispose { analysisExecutor.shutdown() } }

    val hint = live?.let { Quality.liveHint(it) }
    LaunchedEffect(hint) { if (hint != null && now - started > 2500) voice.say(hint) }
    val ready = live?.ready == true && stable >= CaptureGuide.STABLE_FRAMES

    fun shoot(override: Boolean) {
        if (busy) return
        busy = true
        capture.takePicture(ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageCapturedCallback() {
            override fun onCaptureSuccess(image: ImageProxy) {
                val photo = runCatching { processCapture(image, step, override) }.getOrNull()
                image.close(); busy = false
                if (photo != null) {
                    review = photo
                    voice.say(if (photo.quality.status == Quality.Status.UNUSABLE) "Let's retake that one. ${photo.quality.tip}" else "Got it.", force = true)
                }
            }
            override fun onError(exception: ImageCaptureException) { busy = false }
        })
    }
    LaunchedEffect(ready, autoCapture) { if (ready && autoCapture && review == null) shoot(false) }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (granted) {
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { ctx ->
                PreviewView(ctx).apply {
                    scaleType = PreviewView.ScaleType.FILL_CENTER
                    val providerFuture = ProcessCameraProvider.getInstance(ctx)
                    providerFuture.addListener({
                        val provider = providerFuture.get()
                        val preview = Preview.Builder().build().also { it.setSurfaceProvider(surfaceProvider) }
                        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build().also {
                            it.setAnalyzer(analysisExecutor, LiveAnalyzer({ step.view }) { r -> live = r; stable = if (r.ready) stable + 1 else 0 })
                        }
                        provider.unbindAll()
                        val cam = provider.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture, analysis)
                        cameraControl = cam.cameraControl
                    }, ContextCompat.getMainExecutor(ctx))
                }
            })
            CaptureOverlay(step.overlay, ready)
        } else {
            Column(Modifier.align(Alignment.Center).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Camera access is needed for guided photos.", color = Color.White)
                Spacer(Modifier.height(12.dp)); Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
            }
        }

        // Top bar: progress, title, instruction, controls.
        Row(Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.45f)).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose) { Icon(Icons.Default.Close, "Close", tint = Color.White) }
            Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                Text("Photo ${index + 1} of $total · ${step.title}${if (step.withAligner) " · aligners in" else " · aligners out"}", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(step.instruction, color = Color.White.copy(alpha = 0.8f), fontSize = 13.sp, maxLines = 2)
            }
            IconButton(onClick = { torch = !torch; cameraControl?.enableTorch(torch) }) { Icon(if (torch) Icons.Default.FlashOn else Icons.Default.FlashOff, "Light", tint = Color.White) }
            IconButton(onClick = onToggleVoice) { Icon(if (voiceOn) Icons.Default.VolumeUp else Icons.Default.VolumeOff, "Voice guidance", tint = Color.White) }
        }

        // Live check chips (left) and shutter (right).
        Column(Modifier.align(Alignment.CenterStart).padding(start = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val r = live
            CheckChip("Light", r?.checks?.first { it.id == Quality.CheckId.EXPOSURE }?.passed)
            CheckChip("Focus", r?.checks?.first { it.id == Quality.CheckId.SHARPNESS }?.passed)
            CheckChip("Glare", r?.checks?.first { it.id == Quality.CheckId.CLIPPING }?.passed)
            CheckChip("Framing", r?.checks?.first { it.id == Quality.CheckId.FRAMING }?.passed)
        }
        Column(Modifier.align(Alignment.CenterEnd).padding(end = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val canShoot = ready || overrideAllowed
            Box(Modifier.size(84.dp).clip(CircleShape).border(5.dp, if (ready) Color(0xFF6BD49A) else Color.White.copy(alpha = if (canShoot) 1f else 0.4f), CircleShape)
                .clickable(enabled = canShoot && !busy) { shoot(!ready) }.padding(8.dp).clip(CircleShape).background(if (ready) Color(0xFF6BD49A) else Color.White.copy(alpha = if (canShoot) 0.9f else 0.25f)))
            Spacer(Modifier.height(8.dp))
            Text(when { busy -> "Checking…"; ready -> if (autoCapture) "Hold still" else "Tap to capture"; overrideAllowed -> "Capture anyway"; else -> hint ?: "Line up with the outline" },
                color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }

        // Post-capture review with the full-resolution quality verdict.
        review?.let { p ->
            Row(Modifier.fillMaxSize().background(Oma.Navy).padding(24.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                androidx.compose.foundation.Image(p.preview.asImageBitmap(), null, Modifier.weight(1.4f).fillMaxHeight().clip(RoundedCornerShape(18.dp)))
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) {
                    val (title, color) = when (p.quality.status) {
                        Quality.Status.USABLE -> "Looks great" to Color(0xFF6BD49A)
                        Quality.Status.LIMITED -> "Usable, but could be clearer" to Oma.Amber
                        Quality.Status.UNUSABLE -> "Let's retake this one" to Color(0xFFF08A8A)
                    }
                    Text(title, color = color, style = MaterialTheme.typography.headlineSmall.copy(color = color))
                    p.quality.tip?.let { Spacer(Modifier.height(8.dp)); Text(it, color = Color.White.copy(alpha = 0.85f)) }
                    Spacer(Modifier.height(24.dp))
                    if (p.quality.status != Quality.Status.UNUSABLE) Button(onClick = { onCaptured(p) }, modifier = Modifier.fillMaxWidth().height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = Oma.Ember)) { Text("Use photo", fontWeight = FontWeight.SemiBold) }
                    OutlinedButton(onClick = { review = null; stable = 0 }, modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 8.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)) { Text("Retake") }
                    if (p.quality.status == Quality.Status.UNUSABLE) TextButton(onClick = { onCaptured(p.copy(override = true)) }) { Text("Send anyway (clinic may ask again)", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp) }
                }
            }
        }
    }
}

@Composable
private fun CheckChip(label: String, passed: Boolean?) {
    val c = when (passed) { true -> Color(0xFF6BD49A); false -> Oma.Amber; null -> Color.White.copy(alpha = 0.5f) }
    Row(Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.5f)).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(c)); Spacer(Modifier.width(8.dp)); Text(label, color = Color.White, fontSize = 13.sp)
    }
}

/** Decodes, rotates, downsizes to ≤2048 px, re-encodes (dropping EXIF/GPS) and verifies quality at full resolution. */
private fun processCapture(image: ImageProxy, step: CaptureStep, override: Boolean): CapturedPhoto {
    val buf = image.planes[0].buffer.apply { rewind() }
    val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
    var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    val rot = image.imageInfo.rotationDegrees
    if (rot != 0) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rot.toFloat()) }, true)
    val scale = 2048f / max(bmp.width, bmp.height)
    if (scale < 1f) bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
    val out = ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
    val small = Bitmap.createScaledBitmap(bmp, 512, (512f * bmp.height / bmp.width).toInt(), true)
    val px = IntArray(small.width * small.height).also { small.getPixels(it, 0, small.width, 0, 0, small.width, small.height) }
    val q = Quality.analyzeArgb(px, small.width, small.height, step.view, fullShortEdge = minOf(bmp.width, bmp.height))
    return CapturedPhoto(step, out, small, q, override)
}
