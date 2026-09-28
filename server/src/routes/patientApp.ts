import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addDays, daysBetween, nowIso, today } from '../lib/time.js';
import { config } from '../config.js';
import { patient } from '../security/auth.js';
import { randomToken, sha256 } from '../security/crypto.js';
import { audit, auditReq } from '../services/audit.js';
import { serializeImage, storeImage } from '../services/images.js';
import { assessImage } from '../services/quality/imageQuality.js';
import { activePlan, planBundle, totalStages, daysOnStage } from '../services/plan.js';
import { nextCheckinFor, processSubmission, protocolOf, refreshRecommendation, computeCheckinSignals } from '../services/review.js';
import { ISSUE_CATEGORIES, triage, type IssueCategory } from '../services/scheduling/triage.js';
import { systemMessage } from '../services/messaging.js';
import { emit } from '../services/webhooks.js';
import { VIEWS, VIEW_LABELS } from '../services/observations/schema.js';
import { VISIT_LABELS } from '../services/scheduling/appointmentEngine.js';
import { deleteBlob } from '../services/storage.js';

export const patientAppRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 6 } });

// Status labels shown to patients: never clinical, always actionable.
const STATUS_LABELS: Record<string, { label: string; tone: string; detail: string }> = {
  uploading: { label: 'Uploading', tone: 'info', detail: 'Your photos are being sent securely.' },
  quality_check: { label: 'Checking photos', tone: 'info', detail: 'We are checking your photos are clear enough.' },
  awaiting_review: { label: 'Awaiting review', tone: 'info', detail: 'Your orthodontist will review your check-in soon.' },
  retake_requested: { label: 'New photos needed', tone: 'attention', detail: 'Some photos need to be retaken.' },
  reviewed: { label: 'Feedback received', tone: 'stable', detail: 'Your orthodontist has replied.' },
};

patientAppRouter.post('/activate', h((req) => {
  const b = z.object({ clinicCode: z.string().min(2).max(60), activationCode: z.string().min(6).max(12), deviceName: z.string().max(80).optional() }).parse(req.body);
  const slug = b.clinicCode.trim().toLowerCase();
  const code = b.activationCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const t = sql.get("SELECT id FROM tenants WHERE slug = ? AND status IN ('active','trial')", slug);
  const p = t ? sql.get('SELECT * FROM patients WHERE tenant_id = ? AND activation_code_hash = ?', t.id, sha256(`${slug}:${code}`)) : null;
  if (!p || !p.activation_expires_at || p.activation_expires_at < nowIso()) throw new HttpError(401, 'That code is not valid or has expired. Ask your clinic for a new one.', 'invalid_code');
  const token = `omp_${randomToken(32)}`;
  const deviceId = newId('dev');
  sql.tx(() => {
    sql.run('UPDATE patient_devices SET revoked_at = ? WHERE patient_id = ? AND revoked_at IS NULL', nowIso(), p.id); // one active device per patient
    sql.insert('patient_devices', { id: deviceId, tenant_id: p.tenant_id, patient_id: p.id, token_hash: sha256(token), platform: b.deviceName ?? 'android', created_at: nowIso() });
    sql.update('patients', p.id, p.tenant_id, { activation_code_hash: null, activation_expires_at: null, status: p.status === 'invited' ? 'active' : p.status });
  });
  audit({ tenantId: p.tenant_id, actorType: 'patient', actorId: p.id, patientId: p.id, action: 'patient.activate', ip: req.ip, meta: { deviceId } });
  return { token, patientId: p.id, firstName: p.first_name };
}));

patientAppRouter.get('/home', h((req) => {
  const c = patient(req);
  const p = sql.get('SELECT * FROM patients WHERE id = ?', c.patientId)!;
  const t = sql.get('SELECT name, branding_json FROM tenants WHERE id = ?', c.tenantId)!;
  const planRow = activePlan(c.tenantId, p.id);
  const bundle = planRow ? planBundle(c.tenantId, planRow.id) : null;
  const stage = bundle?.stages.find((s: any) => s.stage_no === bundle.current_stage);
  const proto = protocolOf(c.tenantId, p.id);
  const checkins = sql.all('SELECT * FROM checkins WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC LIMIT 8', c.tenantId, p.id);
  const next = nextCheckinFor(c.tenantId, p.id);
  const appt = sql.get("SELECT a.*, b.name AS branch, b.address, u.name AS doctor FROM appointments a JOIN branches b ON b.id = a.branch_id LEFT JOIN users u ON u.id = a.doctor_id WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status IN ('booked','requested') AND a.start_at >= ? ORDER BY a.start_at LIMIT 1", c.tenantId, p.id, today());
  const lastDecision = sql.get('SELECT * FROM decisions WHERE tenant_id = ? AND patient_id = ? ORDER BY decided_at DESC LIMIT 1', c.tenantId, p.id);
  const unread = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND patient_id = ? AND sender_type != 'patient' AND read_at IS NULL", c.tenantId, p.id)?.n ?? 0;
  const wearWeek = sql.all('SELECT date, hours FROM wear_logs WHERE tenant_id = ? AND patient_id = ? AND date >= ? ORDER BY date', c.tenantId, p.id, addDays(today(), -6));
  const openIssue = sql.get("SELECT * FROM issue_reports WHERE tenant_id = ? AND patient_id = ? AND triage_status != 'resolved' ORDER BY created_at DESC LIMIT 1", c.tenantId, p.id);

  // Today's action: the single most important thing for the patient to do now.
  const retake = checkins.find((x) => x.status === 'retake_requested');
  const inFlight = checkins.find((x) => ['uploading', 'quality_check', 'awaiting_review'].includes(x.status));
  let action: { kind: string; title: string; detail: string; checkinId?: string; views?: string[] };
  if (retake) {
    const bad = sql.all("SELECT DISTINCT view FROM images WHERE owner_type = 'checkin' AND owner_id = ? AND quality_status = 'unusable'", retake.id).map((r) => r.view);
    const dec = sql.get("SELECT retake_views_json FROM decisions WHERE checkin_id = ? AND type = 'retake' ORDER BY decided_at DESC LIMIT 1", retake.id);
    const required = [...new Set((proto?.required_views ?? []).map((v) => v.view))];
    const missing = required.filter((v) => !sql.get("SELECT id FROM images WHERE owner_type = 'checkin' AND owner_id = ? AND view = ? AND quality_status != 'unusable'", retake.id, v));
    const views = [...new Set([...j.parse<string[]>(dec?.retake_views_json, []), ...bad, ...missing])];
    action = { kind: 'retake', title: `Retake ${views.length} photo${views.length === 1 ? '' : 's'}`, detail: views.map((v) => VIEW_LABELS[v as keyof typeof VIEW_LABELS] ?? v).join(', '), checkinId: retake.id, views };
  } else if (lastDecision?.type === 'go' && lastDecision.decided_at.slice(0, 10) >= addDays(today(), -1) && daysBetween(lastDecision.decided_at.slice(0, 10), today()) <= 1) {
    action = { kind: 'switch', title: `Switch to aligner ${lastDecision.stage_to}`, detail: 'Approved by your orthodontist. Put it in tonight before bed.' };
  } else if (inFlight) {
    action = { kind: 'wait', title: STATUS_LABELS[inFlight.status].label, detail: 'Keep wearing your current aligner until you hear back.', checkinId: inFlight.id };
  } else if (next.date <= today()) {
    action = { kind: 'checkin', title: 'Check-in due today', detail: `${proto?.required_views.length ?? 5} photos · about 3 minutes` };
  } else {
    action = { kind: 'wear', title: 'Keep wearing your aligner', detail: `Next check-in ${next.date}` };
  }

  return {
    clinic: { name: t.name, branding: j.parse(t.branding_json, {}) },
    patient: { firstName: p.first_name, mode: p.mode, consent: j.parse(p.consent_json, {}) },
    action,
    stage: bundle ? { current: bundle.current_stage, total: totalStages(bundle), daysOn: daysOnStage(bundle), stageDays: bundle.stage_days, nextChange: stage?.expected_change ?? null,
      held: stage?.status === 'held' } : null,
    nextCheckin: next,
    appointment: appt ? { id: appt.id, startAt: appt.start_at, durationMin: appt.duration_min, type: VISIT_LABELS[appt.type as keyof typeof VISIT_LABELS] ?? appt.type, status: appt.status, branch: appt.branch, address: appt.address, doctor: appt.doctor } : null,
    requiredViews: proto?.required_views ?? VIEWS.map((v) => ({ view: v, with_aligner: true })),
    checkins: checkins.map((x) => ({ id: x.id, clientUuid: x.client_uuid, status: x.status, ...STATUS_LABELS[x.status], stageNo: x.stage_no, createdAt: x.created_at, submittedAt: x.submitted_at,
      feedback: x.status === 'reviewed' || x.status === 'retake_requested' ? sql.get('SELECT message FROM decisions WHERE checkin_id = ? ORDER BY decided_at DESC LIMIT 1', x.id)?.message ?? null : null })),
    openIssue: openIssue ? { id: openIssue.id, category: ISSUE_CATEGORIES[openIssue.category as IssueCategory], status: openIssue.triage_status, createdAt: openIssue.created_at } : null,
    unreadMessages: unread,
    wear: { week: wearWeek, todayHours: wearWeek.find((w) => w.date === today())?.hours ?? null, targetHours: proto?.go_criteria.minWearHours ?? 22 },
  };
}));

// ── Check-ins ────────────────────────────────────────────────────────────────
const CheckinBody = z.object({
  clientUuid: z.string().uuid(), reportedAligner: z.number().int().min(1).max(99).nullable().optional(),
  wear: z.enum(['<16', '16-20', '20-22', '22+']).nullable().optional(), fit: z.enum(['good', 'poor', 'unsure']).nullable().optional(),
  symptoms: z.array(z.string().max(40)).max(10).default([]), painLevel: z.number().int().min(0).max(10).default(0), concerns: z.string().max(2000).optional().nullable(),
});

patientAppRouter.post('/checkins', h((req) => {
  const c = patient(req);
  const b = CheckinBody.parse(req.body);
  const existing = sql.get('SELECT * FROM checkins WHERE patient_id = ? AND client_uuid = ?', c.patientId, b.clientUuid);
  if (existing) return { id: existing.id, status: existing.status, idempotent: true };
  const p = sql.get('SELECT consent_json FROM patients WHERE id = ?', c.patientId)!;
  if (!j.parse<Record<string, boolean>>(p.consent_json, {}).photos) throw new HttpError(409, 'Photo consent is required. Please contact your clinic.', 'no_consent');
  const planRow = activePlan(c.tenantId, c.patientId);
  const id = newId('chk');
  sql.insert('checkins', { id, tenant_id: c.tenantId, patient_id: c.patientId, plan_id: planRow?.id ?? null, client_uuid: b.clientUuid, stage_no: planRow?.current_stage ?? null,
    reported_aligner: b.reportedAligner ?? null, wear_hours_bucket: b.wear ?? null, fit: b.fit ?? null, symptoms_json: j.str(b.symptoms), pain_level: b.painLevel, concerns: b.concerns ?? null,
    status: 'uploading', created_at: nowIso() });
  auditReq(req, 'checkin.create', 'checkin', id, { patientId: c.patientId });
  return { id, status: 'uploading', idempotent: false };
}));

patientAppRouter.post('/checkins/:id/images', upload.single('image'), h((req) => {
  const c = patient(req);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND patient_id = ? AND tenant_id = ?', req.params.id, c.patientId, c.tenantId);
  if (!chk) throw notFound('Check-in');
  if (!['uploading', 'retake_requested'].includes(chk.status)) throw new HttpError(409, 'This check-in is no longer accepting photos', 'conflict');
  if (!req.file) throw badRequest('Image file is required');
  const view = z.enum(VIEWS).parse(req.body.view);
  const withAligner = req.body.withAligner === 'true' || req.body.withAligner === true;
  const hash = sha256(req.file.buffer);
  const dup = sql.get("SELECT * FROM images WHERE owner_type = 'checkin' AND owner_id = ? AND sha256 = ?", chk.id, hash);
  if (dup) return { ...serializeImage(dup), idempotent: true };
  // A retake replaces the earlier image for the same view/aligner state.
  const old = sql.all("SELECT * FROM images WHERE owner_type = 'checkin' AND owner_id = ? AND view = ? AND with_aligner = ?", chk.id, view, withAligner ? 1 : 0);
  const out = storeImage(req.file.buffer, { tenantId: c.tenantId, patientId: c.patientId, ownerType: 'checkin', ownerId: chk.id, view, withAligner,
    patientOverride: req.body.patientOverride === 'true', capturedAt: typeof req.body.capturedAt === 'string' ? req.body.capturedAt : null });
  for (const o of old) { deleteBlob(c.tenantId, o.storage_key); sql.run('DELETE FROM images WHERE id = ?', o.id); }
  return { ...serializeImage(sql.get('SELECT * FROM images WHERE id = ?', out.id)), idempotent: false };
}));

patientAppRouter.post('/checkins/:id/submit', h(async (req) => {
  const c = patient(req);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND patient_id = ? AND tenant_id = ?', req.params.id, c.patientId, c.tenantId);
  if (!chk) throw notFound('Check-in');
  if (!['uploading', 'retake_requested'].includes(chk.status)) return { status: chk.status, idempotent: true };
  const n = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM images WHERE owner_type = 'checkin' AND owner_id = ?", chk.id)?.n ?? 0;
  if (!n) throw badRequest('Add at least one photo before submitting');
  const out = await processSubmission(c.tenantId, chk.id);
  auditReq(req, 'checkin.submit', 'checkin', chk.id, { patientId: c.patientId, meta: out });
  return out;
}));

patientAppRouter.get('/checkins/:id', h((req) => {
  const c = patient(req);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND patient_id = ? AND tenant_id = ?', req.params.id, c.patientId, c.tenantId);
  if (!chk) throw notFound('Check-in');
  const imgs = sql.all("SELECT * FROM images WHERE owner_type = 'checkin' AND owner_id = ?", chk.id);
  const dec = sql.get('SELECT message, type, decided_at FROM decisions WHERE checkin_id = ? ORDER BY decided_at DESC LIMIT 1', chk.id);
  return { id: chk.id, status: chk.status, ...STATUS_LABELS[chk.status], images: imgs.map((i) => ({ id: i.id, view: i.view, withAligner: !!i.with_aligner, qualityStatus: i.quality_status, retakeTip: j.parse<{ retakeTip?: string }>(i.quality_json, {}).retakeTip ?? null })),
    feedback: dec ? { message: dec.message, type: dec.type, at: dec.decided_at } : null };
}));

/** Stateless quality pre-check so the app can confirm its on-device verdict before queueing (no storage). */
patientAppRouter.post('/quality-check', upload.single('image'), h((req) => {
  patient(req);
  if (!req.file) throw badRequest('Image file is required');
  try { return assessImage(req.file.buffer, undefined, typeof req.body.view === 'string' ? req.body.view : null); } catch { throw badRequest('Image could not be decoded'); }
}));

// ── Issue reports (triage) ───────────────────────────────────────────────────
patientAppRouter.post('/issues', upload.array('photos', 4), h((req) => {
  const c = patient(req);
  const b = z.object({ clientUuid: z.string().uuid(), category: z.enum(Object.keys(ISSUE_CATEGORIES) as [IssueCategory, ...IssueCategory[]]),
    painLevel: z.coerce.number().int().min(0).max(10).default(0), severity: z.coerce.number().int().min(1).max(5).optional(), details: z.string().max(2000).optional(),
    attachmentsOffCount: z.coerce.number().int().min(0).max(20).optional() }).parse(req.body);
  const dup = sql.get('SELECT * FROM issue_reports WHERE patient_id = ? AND client_uuid = ?', c.patientId, b.clientUuid);
  if (dup) return { id: dup.id, urgency: dup.urgency, guidance: triage({ category: dup.category }).guidance, idempotent: true };
  const t = triage({ category: b.category, painLevel: b.painLevel, severitySelf: b.severity, details: b.details, attachmentsOffCount: b.attachmentsOffCount });
  const id = newId('iss');
  sql.insert('issue_reports', { id, tenant_id: c.tenantId, patient_id: c.patientId, client_uuid: b.clientUuid, category: b.category, severity_self: b.severity ?? null, pain_level: b.painLevel,
    details: b.details ?? null, urgency: t.urgency, urgency_reasons_json: j.str(t.reasons), triage_status: 'open', sla_due_at: new Date(Date.now() + t.slaMinutes * 60_000).toISOString(), created_at: nowIso() });
  for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) storeImage(f.buffer, { tenantId: c.tenantId, patientId: c.patientId, ownerType: 'issue', ownerId: id, kind: 'issue' });
  systemMessage(c.tenantId, c.patientId, `We received your report (${ISSUE_CATEGORIES[b.category]}). ${t.urgency === 'P1' || t.urgency === 'P2' ? 'Our team has been alerted and will contact you as soon as possible.' : 'The clinic team will review it.'}\n\nWhile you wait: ${t.guidance}${t.urgency === 'P1' ? '\n\nIf you have trouble breathing or swallowing, or severe swelling, call emergency services now.' : ''}`, 'issue_received');
  auditReq(req, 'issue.report', 'issue', id, { patientId: c.patientId, meta: { category: b.category, urgency: t.urgency } });
  emit(c.tenantId, 'issue.reported', { issue_id: id, patient_id: c.patientId, category: b.category, urgency: t.urgency });
  // Urgent reports affect any check-in awaiting review, and may change the appointment recommendation (still staff-approved).
  for (const x of sql.all("SELECT id FROM checkins WHERE tenant_id = ? AND patient_id = ? AND status = 'awaiting_review'", c.tenantId, c.patientId)) computeCheckinSignals(c.tenantId, x.id);
  refreshRecommendation(c.tenantId, c.patientId);
  return { id, urgency: t.urgency, guidance: t.guidance, emergency: t.urgency === 'P1', idempotent: false };
}));

// ── Messages ─────────────────────────────────────────────────────────────────
patientAppRouter.get('/messages', h((req) => {
  const c = patient(req);
  sql.run("UPDATE messages SET read_at = ? WHERE tenant_id = ? AND patient_id = ? AND sender_type != 'patient' AND read_at IS NULL", nowIso(), c.tenantId, c.patientId);
  return sql.all('SELECT m.*, u.name AS sender_name, u.title FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.tenant_id = ? AND m.patient_id = ? ORDER BY m.created_at', c.tenantId, c.patientId)
    .map((m) => ({ id: m.id, fromPatient: m.sender_type === 'patient', senderName: m.sender_type === 'system' ? 'Clinic assistant' : m.sender_name ?? 'You', body: m.body, imageIds: j.parse(m.image_ids_json, []), automated: !!m.automated_rule, createdAt: m.created_at }));
}));

patientAppRouter.post('/messages', upload.array('photos', 3), h((req) => {
  const c = patient(req);
  const b = z.object({ body: z.string().min(1).max(4000), clientUuid: z.string().uuid().optional() }).parse(req.body);
  if (b.clientUuid) { const dup = sql.get('SELECT id FROM messages WHERE patient_id = ? AND client_uuid = ?', c.patientId, b.clientUuid); if (dup) return { id: dup.id, idempotent: true }; }
  const id = newId('msg');
  const imageIds = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => storeImage(f.buffer, { tenantId: c.tenantId, patientId: c.patientId, ownerType: 'message', ownerId: id, kind: 'message' }).id);
  sql.insert('messages', { id, tenant_id: c.tenantId, patient_id: c.patientId, sender_type: 'patient', sender_id: c.patientId, body: b.body, image_ids_json: j.str(imageIds), client_uuid: b.clientUuid ?? null, created_at: nowIso() });
  return { id, idempotent: false };
}));

// ── Wear log, education, progress, appointments ─────────────────────────────
patientAppRouter.post('/wear', h((req) => {
  const c = patient(req);
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hours: z.number().min(0).max(24) }).parse(req.body);
  if (b.date > today() || b.date < addDays(today(), -14)) throw badRequest('Wear can be logged for the last 14 days only');
  const ex = sql.get('SELECT id FROM wear_logs WHERE patient_id = ? AND date = ?', c.patientId, b.date);
  if (ex) sql.run('UPDATE wear_logs SET hours = ? WHERE id = ?', b.hours, ex.id);
  else sql.insert('wear_logs', { id: newId('wr'), tenant_id: c.tenantId, patient_id: c.patientId, date: b.date, hours: b.hours });
  return { ok: true };
}));

patientAppRouter.get('/education', h((req) => {
  const c = patient(req);
  return sql.all('SELECT e.*, u.name AS approver FROM education e LEFT JOIN users u ON u.id = e.approved_by WHERE e.tenant_id = ? AND e.published = 1 ORDER BY e.category, e.title', c.tenantId)
    .map((e) => ({ id: e.id, title: e.title, summary: e.summary, body: e.body_md, category: e.category, readMinutes: e.read_minutes, approvedBy: e.approver }));
}));

patientAppRouter.get('/progress', h((req) => {
  const c = patient(req);
  // Only images from check-ins a clinician has reviewed are shown in the patient's progress view.
  const reviewed = sql.all("SELECT id, submitted_at, stage_no FROM checkins WHERE tenant_id = ? AND patient_id = ? AND status = 'reviewed' ORDER BY submitted_at", c.tenantId, c.patientId);
  const pick = (chkId: string) => sql.get("SELECT id FROM images WHERE owner_type = 'checkin' AND owner_id = ? AND view = 'front' AND quality_status != 'unusable' ORDER BY with_aligner LIMIT 1", chkId)?.id ?? null;
  const planRow = activePlan(c.tenantId, c.patientId);
  const bundle = planRow ? planBundle(c.tenantId, planRow.id) : null;
  return {
    first: reviewed[0] ? { imageId: pick(reviewed[0].id), date: reviewed[0].submitted_at, stage: reviewed[0].stage_no } : null,
    latest: reviewed.length > 1 ? { imageId: pick(reviewed[reviewed.length - 1].id), date: reviewed[reviewed.length - 1].submitted_at, stage: reviewed[reviewed.length - 1].stage_no } : null,
    timeline: (bundle?.stages ?? []).map((s: any) => ({ stage: s.stage_no, status: s.status, start: s.actual_start ?? s.expected_start, change: s.expected_change })),
  };
}));

patientAppRouter.get('/appointments', h((req) => {
  const c = patient(req);
  return sql.all("SELECT a.*, b.name AS branch, b.address, u.name AS doctor FROM appointments a JOIN branches b ON b.id = a.branch_id LEFT JOIN users u ON u.id = a.doctor_id WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status != 'cancelled' ORDER BY a.start_at DESC", c.tenantId, c.patientId)
    .map((a) => ({ id: a.id, startAt: a.start_at, durationMin: a.duration_min, type: VISIT_LABELS[a.type as keyof typeof VISIT_LABELS] ?? a.type, status: a.status, branch: a.branch, address: a.address, doctor: a.doctor }));
}));

patientAppRouter.post('/logout', h((req) => {
  const c = patient(req);
  sql.run('UPDATE patient_devices SET revoked_at = ? WHERE id = ?', nowIso(), c.deviceId);
  return { ok: true };
}));
