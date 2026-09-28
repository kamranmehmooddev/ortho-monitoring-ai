package ai.orthomonitoring.patient.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape

/** Meridian brand tokens (shared with the clinic web app). */
object Oma {
    val Navy = Color(0xFF10133A); val Navy2 = Color(0xFF181C4A)
    val Ember = Color(0xFFE8590C); val Amber = Color(0xFFF5B400)
    val Canvas = Color(0xFFF7F6F2); val Surface = Color.White; val Sunken = Color(0xFFF1EFE9); val Line = Color(0xFFE5E2DA)
    val Ink = Color(0xFF10133A); val Ink2 = Color(0xFF3A3E5E); val Ink3 = Color(0xFF686C86)
    val Urgent = Color(0xFFB4232F); val UrgentSoft = Color(0xFFFBEAEB)
    val Attention = Color(0xFFA86008); val AttentionSoft = Color(0xFFFCF3E0)
    val Stable = Color(0xFF2F7D4F); val StableSoft = Color(0xFFE5F4EB)
    val Info = Color(0xFF3D5A80); val InfoSoft = Color(0xFFE8EFF8)
    val BrandGradient = Brush.horizontalGradient(listOf(Ember, Color(0xFFF29A0F), Amber))
    fun accent(hex: String?): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Navy)
}

private val Serif = FontFamily.Serif
private val typography = Typography(
    displaySmall = TextStyle(fontFamily = Serif, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, lineHeight = 38.sp, color = Oma.Ink),
    headlineMedium = TextStyle(fontFamily = Serif, fontWeight = FontWeight.SemiBold, fontSize = 28.sp, lineHeight = 32.sp, color = Oma.Ink),
    headlineSmall = TextStyle(fontFamily = Serif, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp, color = Oma.Ink),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 11.sp, letterSpacing = 1.sp),
)

@Composable
fun OmaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Oma.Navy, onPrimary = Color.White, secondary = Oma.Ember, onSecondary = Color.White, tertiary = Oma.Amber,
            background = Oma.Canvas, onBackground = Oma.Ink, surface = Oma.Surface, onSurface = Oma.Ink, surfaceVariant = Oma.Sunken, onSurfaceVariant = Oma.Ink3,
            outline = Oma.Line, error = Oma.Urgent,
        ),
        typography = typography,
        shapes = Shapes(small = RoundedCornerShape(10.dp), medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(24.dp)),
        content = content,
    )
}
