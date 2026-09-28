package ai.orthomonitoring.patient.camera

import ai.orthomonitoring.core.CaptureView
import ai.orthomonitoring.core.Quality
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy

/** Runs the deterministic quality checks on the live preview's Y plane (≈10 fps) so the shutter only turns green on a usable frame. */
class LiveAnalyzer(private val view: () -> CaptureView, private val onResult: (Quality.Result) -> Unit) : ImageAnalysis.Analyzer {
    private var lastRun = 0L
    override fun analyze(image: ImageProxy) {
        val now = System.currentTimeMillis()
        if (now - lastRun < 100) { image.close(); return }
        lastRun = now
        try {
            val plane = image.planes[0]
            val buf = plane.buffer.apply { rewind() }
            val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
            // The capture use case runs at full resolution; resolution is checked on the captured photo.
            onResult(Quality.analyzeLuma(bytes, image.width, image.height, plane.rowStride, view(), fullShortEdge = 1080))
        } finally { image.close() }
    }
}
