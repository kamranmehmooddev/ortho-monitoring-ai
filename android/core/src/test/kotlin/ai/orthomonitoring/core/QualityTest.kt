package ai.orthomonitoring.core

import java.io.File
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Parity with the server's quality-v1.2 service, using the same synthetic seed images. */
class QualityTest {
    private val assets = listOf(File("../server/seed-assets"), File("../../server/seed-assets")).first { it.exists() }

    private fun analyze(name: String, view: CaptureView): Quality.Result {
        val img = ImageIO.read(File(assets, "$name.jpg"))
        val px = img.getRGB(0, 0, img.width, img.height, null, 0, img.width)
        return Quality.analyzeArgb(px, img.width, img.height, view)
    }

    @Test fun `well-lit sharp framed images are usable`() {
        assertEquals(Quality.Status.USABLE, analyze("front_aligner_a", CaptureView.FRONT).status)
        assertEquals(Quality.Status.USABLE, analyze("upper_noaligner_a", CaptureView.UPPER).status)
        assertEquals(Quality.Status.USABLE, analyze("right_aligner_b", CaptureView.RIGHT).status)
    }

    @Test fun `dark photo is unusable with a lighting tip`() {
        val r = analyze("front_dark_a", CaptureView.FRONT)
        assertEquals(Quality.Status.UNUSABLE, r.status)
        assertTrue(r.tip!!.contains("window"))
        assertEquals("Too dark: find more light", Quality.liveHint(r))
    }

    @Test fun `blurry photo is unusable`() {
        val r = analyze("left_blurry_a", CaptureView.LEFT)
        assertEquals(Quality.Status.UNUSABLE, r.status)
        assertTrue(r.checks.first { it.id == Quality.CheckId.SHARPNESS }.let { !it.passed && it.hard })
    }

    @Test fun `glare is limited, not unusable`() {
        assertEquals(Quality.Status.LIMITED, analyze("upper_glare_a", CaptureView.UPPER).status)
    }

    @Test fun `low resolution is a hard fail`() {
        val w = 400; val h = 300
        val px = IntArray(w * h) { i -> if ((i / 7) % 2 == 0) 0xFFEDE6D6.toInt() else 0xFF503030.toInt() }
        val r = Quality.analyzeArgb(px, w, h, CaptureView.FRONT)
        assertEquals(Quality.Status.UNUSABLE, r.status)
    }

    @Test fun `live luma analysis respects row stride`() {
        val w = 1280; val h = 960; val stride = 1344
        val y = ByteArray(stride * h) { i -> val x = i % stride; val row = i / stride; (if ((x / 16 + row / 16) % 2 == 0) 200 else 60).toByte() }
        val r = Quality.analyzeLuma(y, w, h, stride, CaptureView.FRONT)
        assertTrue(r.sharpness > Quality.SHARP_SOFT)
        assertTrue(r.meanLuma in 100.0..160.0)
    }
}
