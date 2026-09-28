package ai.orthomonitoring.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QueueAndGuideTest {
    private fun img(id: String, v: CaptureView, state: ItemState = ItemState.PENDING, attempts: Int = 0) =
        QueuedImage(id, v, true, "/f/$id", "sha$id", false, "2026-09-28T10:00:00Z", state, attempts)
    private fun checkin(images: List<QueuedImage>, serverId: String? = null, submitted: Boolean = false) =
        QueuedCheckin("uuid", "2026-09-28T10:00:00Z", 8, "22+", "good", emptyList(), 0, null, images, serverId, submitted)

    @Test fun `phases progress create, upload, submit, submitted`() {
        val a = img("a", CaptureView.FRONT); val b = img("b", CaptureView.LEFT)
        assertEquals(QueuedCheckin.Phase.CREATE, checkin(listOf(a, b)).phase)
        assertEquals(QueuedCheckin.Phase.UPLOAD_IMAGES, checkin(listOf(a, b), "chk_1").phase)
        assertEquals(QueuedCheckin.Phase.SUBMIT, checkin(listOf(a.copy(state = ItemState.DONE), b.copy(state = ItemState.DONE)), "chk_1").phase)
        assertEquals(QueuedCheckin.Phase.SUBMITTED, checkin(listOf(a), "chk_1", submitted = true).phase)
    }

    @Test fun `retake check-ins skip creation`() {
        val c = checkin(listOf(img("a", CaptureView.FRONT))).copy(retakeOf = "chk_9")
        assertEquals(QueuedCheckin.Phase.UPLOAD_IMAGES, c.phase)
    }

    @Test fun `network errors and 5xx retry, 4xx fail permanently, 409 counts as done`() {
        val i = img("a", CaptureView.FRONT)
        assertEquals(ItemState.PENDING, UploadPolicy.onImageResult(i, null, null).state)
        assertEquals(ItemState.PENDING, UploadPolicy.onImageResult(i, 503, null).state)
        assertEquals(ItemState.FAILED_PERMANENT, UploadPolicy.onImageResult(i, 400, null).state)
        assertEquals(ItemState.DONE, UploadPolicy.onImageResult(i, 409, null).state)
        assertEquals(ItemState.DONE, UploadPolicy.onImageResult(i, 200, "img_1").state)
        assertEquals(ItemState.FAILED_PERMANENT, UploadPolicy.onImageResult(i.copy(attempts = UploadPolicy.MAX_ATTEMPTS - 1), 503, null).state)
    }

    @Test fun `backoff grows and is capped`() {
        assertEquals(15_000L, UploadPolicy.backoffMs(0))
        assertEquals(60_000L, UploadPolicy.backoffMs(2))
        assertEquals(30 * 60_000L, UploadPolicy.backoffMs(20))
    }

    @Test fun `least-attempted pending image goes next`() {
        val c = checkin(listOf(img("a", CaptureView.FRONT, attempts = 3), img("b", CaptureView.LEFT, attempts = 0), img("c", CaptureView.UPPER, ItemState.DONE)), "chk")
        assertEquals("b", UploadPolicy.next(c)?.localId)
        assertNull(UploadPolicy.next(c.copy(images = c.images.map { it.copy(state = ItemState.DONE) })))
    }

    @Test fun `offline status reassures the patient`() {
        val l = CheckinStatus.local(checkin(listOf(img("a", CaptureView.FRONT)), "chk"), online = false)
        assertEquals("Waiting for connection", l.title)
        assertEquals("New photos needed", CheckinStatus.server("retake_requested").title)
    }

    @Test fun `guide orders steps clinically and puts aligner-in first`() {
        val steps = CaptureGuide.steps(listOf(CaptureView.UPPER to false, CaptureView.FRONT to false, CaptureView.FRONT to true, CaptureView.LEFT to true))
        assertEquals(listOf("front:in", "front:out", "left:in", "upper:out"), steps.map { it.key })
        assertTrue(steps.all { it.voice.isNotBlank() })
    }

    @Test fun `wear streak and buckets`() {
        assertEquals(2, Wear.streak(listOf(22.0, 23.0, 18.0, 22.0), 22.0))
        assertEquals("20-22", Wear.bucket(21.0))
    }
}
