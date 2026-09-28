@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package ai.orthomonitoring.patient.ui.components

import ai.orthomonitoring.patient.ui.theme.Oma
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Brand mark drawn natively (tooth outline + monitoring pulse). */
@Composable
fun LogoMark(size: Dp = 32.dp, tooth: Color = Color.White) {
    Canvas(Modifier.size(size)) {
        val s = this.size.width / 64f
        val t = Path().apply {
            moveTo(22f * s, 10f * s)
            cubicTo(14.5f * s, 10f * s, 11f * s, 15.2f * s, 11f * s, 22.6f * s)
            cubicTo(11f * s, 30f * s, 14.6f * s, 34.9f * s, 16.3f * s, 42.2f * s)
            cubicTo(17.7f * s, 48.4f * s, 18.8f * s, 54.2f * s, 22.5f * s, 54.2f * s)
            cubicTo(26.2f * s, 54.2f * s, 26.3f * s, 47.2f * s, 28f * s, 42.2f * s)
            cubicTo(28.8f * s, 39.8f * s, 30.3f * s, 38.6f * s, 32f * s, 38.6f * s)
            cubicTo(33.7f * s, 38.6f * s, 35.2f * s, 39.8f * s, 36f * s, 42.2f * s)
            cubicTo(37.7f * s, 47.2f * s, 37.8f * s, 54.2f * s, 41.5f * s, 54.2f * s)
            cubicTo(45.2f * s, 54.2f * s, 46.3f * s, 48.4f * s, 47.7f * s, 42.2f * s)
            cubicTo(49.4f * s, 34.9f * s, 53f * s, 30f * s, 53f * s, 22.6f * s)
            cubicTo(53f * s, 15.2f * s, 49.5f * s, 10f * s, 42f * s, 10f * s)
            cubicTo(37.6f * s, 10f * s, 35f * s, 12.8f * s, 32f * s, 12.8f * s)
            cubicTo(29f * s, 12.8f * s, 26.4f * s, 10f * s, 22f * s, 10f * s)
            close()
        }
        drawPath(t, tooth, style = Stroke(3.6f * s, join = StrokeJoin.Round))
        val p = Path().apply { moveTo(3f * s, 25.5f * s); lineTo(19.5f * s, 25.5f * s); lineTo(23.1f * s, 17.5f * s); lineTo(28.1f * s, 33f * s); lineTo(31.9f * s, 22.5f * s); lineTo(34.5f * s, 25.5f * s); lineTo(55f * s, 25.5f * s) }
        drawPath(p, Brush.horizontalGradient(listOf(Oma.Ember, Oma.Amber)), style = Stroke(3.6f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawCircle(Oma.Amber, 3.4f * s, Offset(58.2f * s, 25.5f * s))
    }
}

@Composable
fun Wordmark(light: Boolean = true) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        LogoMark(34.dp, if (light) Color.White else Oma.Navy)
        Column {
            Text("Ortho", style = MaterialTheme.typography.titleMedium.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Serif, fontSize = 20.sp), color = if (light) Color.White else Oma.Navy)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Monitoring ", style = MaterialTheme.typography.titleMedium.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Serif, fontSize = 20.sp), color = if (light) Color.White else Oma.Navy)
                Box(Modifier.clip(RoundedCornerShape(5.dp)).background(Oma.BrandGradient).padding(horizontal = 5.dp, vertical = 1.dp)) {
                    Text("AI", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = Oma.Navy, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
                }
            }
        }
    }
}

enum class Tone(val fg: Color, val bg: Color) { INFO(Oma.Info, Oma.InfoSoft), ATTENTION(Oma.Attention, Oma.AttentionSoft), STABLE(Oma.Stable, Oma.StableSoft), URGENT(Oma.Urgent, Oma.UrgentSoft), NEUTRAL(Oma.Ink2, Oma.Sunken) }

fun toneOf(s: String?) = when (s) { "stable" -> Tone.STABLE; "attention" -> Tone.ATTENTION; "urgent" -> Tone.URGENT; "info" -> Tone.INFO; else -> Tone.NEUTRAL }

@Composable
fun StatusChip(text: String, tone: Tone) {
    Row(Modifier.clip(CircleShape).background(tone.bg).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(tone.fg)); Spacer(Modifier.width(6.dp))
        Text(text, color = tone.fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun OmaCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Oma.Surface).border(1.dp, Oma.Line, RoundedCornerShape(20.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(18.dp),
        content = content,
    )
}

@Composable
fun SectionLabel(text: String) = Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = Oma.Ink3, modifier = Modifier.padding(bottom = 8.dp))

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = Oma.Navy, loading: Boolean = false, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !loading, modifier = modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White)) {
        if (loading) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp) else Text(text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

@Composable
fun ChoiceChips(options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            val on = value == selected
            Box(Modifier.clip(CircleShape).background(if (on) Oma.Navy else Oma.Surface).border(1.dp, if (on) Oma.Navy else Oma.Line, CircleShape)
                .clickable { onSelect(value) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(label, color = if (on) Color.White else Oma.Ink, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
fun StageRing(current: Int, total: Int, size: Dp = 96.dp) {
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(size)) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 9.dp.toPx()
            val d = this.size.width - stroke
            drawArc(Oma.Line, 0f, 360f, false, Offset(stroke / 2, stroke / 2), Size(d, d), style = Stroke(stroke))
            drawArc(Oma.BrandGradient, -90f, 360f * current / total.coerceAtLeast(1), false, Offset(stroke / 2, stroke / 2), Size(d, d), style = Stroke(stroke, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$current", style = MaterialTheme.typography.headlineMedium)
            Text("of $total", fontSize = 11.sp, color = Oma.Ink3)
        }
    }
}
