package ai.orthomonitoring.patient.camera

import ai.orthomonitoring.core.OverlayShape
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke

/**
 * Framing guides drawn over the camera preview. They match the regions the quality service measures:
 * a central ellipse for bite views and a U-shaped ring for occlusal (arch) views.
 */
@Composable
fun CaptureOverlay(shape: OverlayShape, ready: Boolean) {
    val color = if (ready) Color(0xFF6BD49A) else Color.White
    Canvas(Modifier.fillMaxSize()) {
        val w = size.width; val h = size.height
        val stroke = Stroke(width = 5f, pathEffect = if (ready) null else PathEffect.dashPathEffect(floatArrayOf(28f, 18f)))
        // Dim everything outside the capture region.
        val rx = w * 0.42f; val ry = h * 0.36f; val cx = w / 2; val cy = h / 2
        val outside = Path().apply { addRect(androidx.compose.ui.geometry.Rect(0f, 0f, w, h)); addOval(androidx.compose.ui.geometry.Rect(cx - rx, cy - ry, cx + rx, cy + ry)); fillType = androidx.compose.ui.graphics.PathFillType.EvenOdd }
        drawPath(outside, Color.Black.copy(alpha = 0.35f))
        when (shape) {
            OverlayShape.BITE_FRONT, OverlayShape.BITE_LEFT, OverlayShape.BITE_RIGHT -> {
                drawOval(color, Offset(cx - rx, cy - ry), Size(rx * 2, ry * 2), style = stroke)
                // Occlusal plane and midline guides.
                drawLine(color.copy(alpha = 0.7f), Offset(cx - rx * 0.85f, cy), Offset(cx + rx * 0.85f, cy), strokeWidth = 3f)
                if (shape == OverlayShape.BITE_FRONT) drawLine(color.copy(alpha = 0.5f), Offset(cx, cy - ry * 0.7f), Offset(cx, cy + ry * 0.7f), strokeWidth = 2f)
                else {
                    // Arrow showing which way to turn the head.
                    val dir = if (shape == OverlayShape.BITE_RIGHT) -1 else 1
                    val ax = cx + dir * rx * 0.95f
                    drawLine(color, Offset(ax - dir * 60f, cy - ry - 30f), Offset(ax, cy - ry - 30f), strokeWidth = 4f)
                    drawLine(color, Offset(ax, cy - ry - 30f), Offset(ax - dir * 18f, cy - ry - 44f), strokeWidth = 4f)
                    drawLine(color, Offset(ax, cy - ry - 30f), Offset(ax - dir * 18f, cy - ry - 16f), strokeWidth = 4f)
                }
            }
            OverlayShape.ARCH_UPPER, OverlayShape.ARCH_LOWER -> {
                val up = shape == OverlayShape.ARCH_UPPER
                val arch = Path().apply {
                    val top = if (up) cy - ry * 0.95f else cy + ry * 0.95f
                    val base = if (up) cy + ry * 0.95f else cy - ry * 0.95f
                    moveTo(cx - rx * 0.9f, base)
                    cubicTo(cx - rx * 0.95f, top, cx + rx * 0.95f, top, cx + rx * 0.9f, base)
                }
                drawPath(arch, color.copy(alpha = 0.12f), style = Stroke(width = 70f))
                drawPath(arch, color, style = stroke)
            }
        }
    }
}
