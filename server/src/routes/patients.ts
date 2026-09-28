import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addDays, nowIso, today } from '../lib/time.js';
import { config } from '../config.js';
import { assertPatientAccess, branchFilter, requireStaff, staff } from '../security/auth.js';
import { hashPassword, randomToken, sha256 } from '../security/crypto.js';
import { auditReq } from '../services/audit.js';
import { serializeImage, storeImage } from '../services/images.js';
import { activePlan, generateStages, planBundle, totalStages } from '../services/plan.js';
import { nextCheckinFor, refreshRecommendation } from '../services/review.js';
import { parseInstructions } from '../services/scheduling/instructionParser.js';
import { staffMessage } from '../services/messaging.js';
import { emit } from '../services/webhooks.js';
import { VIEWS } from '../services/observations/schema.js';
import { ISSUE_CATEGORIES } from '../services/scheduling/triage.js';
import { patientSummary, serializeFinding } from './serializers.js';
import { serializeRec } from './review.js';

export const patientsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 10 } });

function enforcePatientLimit(tenantId: string) {
  const t = sql.get('SELECT p.limits_json FROM tenants t JOIN subscription_plans p ON p.id = t.plan_id WHERE t.id = ?', tenantId);
  const limit = j.parse<{ activePatients?: number }>(t?.limits_json, {}).activePatients;
  if (!limit) return;
  const n = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM patients WHERE tenant_id = ? AND status IN ('active','invited')", tenantId)?.n ?? 0;
  if (n >= Math.floor(limit * 1.1)) throw new HttpError(402, `Your plan allows ${limit} active patients. Upgrade to add more.`, 'plan_limit');
}

patientsRouter.get('/patients', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c);
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const status = String(req.query.status ?? '');
  const params: unknown[] = [c.tenantId, ...bf.params];
  let where = `p.tenant_id = ? ${bf.clause}`;
  if (q) { where += " AND (lower(p.first_name || ' ' || p.last_name) LIKE ? OR lower(p.email) LIKE ? OR p.external_ref LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status) { where += ' AND p.status = ?'; params.push(status); }
  const rows = sql.all(`SELECT p.* FROM patients p WHERE ${where} ORDER BY p.last_name, p.first_name`, ...params);
  return rows.map((p) => {
    const s = patientSummary(c.tenantId, p);
    const openFindings = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM findings WHERE tenant_id = ? AND patient_id = ? AND status = 'open'", c.tenantId, p.id)?.n ?? 0;
    const openIssues = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM issue_reports WHERE tenant_id = ? AND patient_id = ? AND triage_status != 'resolved'", c.tenantId, p.id)?.n ?? 0;
    return { ...s, openFindings, openIssues };
  });
}));

const PatientBody = z.object({
  firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), dob: z.string().optional(), email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(40).optional(), branchId: z.string(), doctorId: z.string(), mode: z.enum(['aligner', 'fixed', 'retention']).default('aligner'),
  protocolId: z.string(), externalRef: z.string().max(80).optional(),
  guardian: z.object({ name: z.string(), phone: z.string().optional(), email: z.string().optional(), relationship: z.string().optional() }).nullable().optional(),
  consent: z.object({ photos: z.boolean(), ai_processing: z.boolean(), messaging: z.boolean(), research: z.boolean().default(false) }),
});

patientsRouter.post('/patients', requireStaff('patients.write'), h((req) => {
  const c = staff(req);
  const b = PatientBody.parse(req.body);
  if (!b.consent.photos) throw badRequest('Photo consent is required for remote monitoring');
  enforcePatientLimit(c.tenantId);
  if (!sql.get('SELECT id FROM branches WHERE id = ? AND tenant_id = ?', b.branchId, c.tenantId)) throw badRequest('Unknown branch');
  if (!sql.get('SELECT id FROM protocols WHERE id = ? AND tenant_id = ?', b.protocolId, c.tenantId)) throw badRequest('Unknown protocol');
  if (!sql.get("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role IN ('orthodontist','dentist','clinic_admin')", b.doctorId, c.tenantId)) throw badRequest('Unknown doctor');
  const id = newId('pat');
  sql.insert('patients', {
    id, tenant_id: c.tenantId, branch_id: b.branchId, doctor_id: b.doctorId, first_name: b.firstName, last_name: b.lastName, dob: b.dob ?? null, email: b.email || null,
    phone: b.phone ?? null, guardian_json: b.guardian ? j.str(b.guardian) : null, mode: b.mode, protocol_id: b.protocolId, status: 'invited',
    consent_json: j.str({ ...b.consent, recorded_at: nowIso(), recorded_by: c.userId }), external_ref: b.externalRef ?? null,
    avatar_hue: Math.floor(Math.random() * 360), created_at: nowIso(),
  });
  auditReq(req, 'patient.create', 'patient', id, { patientId: id, meta: { consent: b.consent } });
  emit(c.tenantId, 'patient.created', { patient_id: id, external_ref: b.externalRef ?? null });
  return patientSummary(c.tenantId, sql.get('SELECT * FROM patients WHERE id = ?', id));
}));

patientsRouter.get('/patients/:id', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const p = sql.get('SELECT * FROM patients WHERE id = ?', req.params.id)!;
  const planRow = activePlan(c.tenantId, p.id);
  const bundle = planRow ? planBundle(c.tenantId, planRow.id) : null;
  const checkins = sql.all('SELECT * FROM checkins WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC', c.tenantId, p.id);
  const findings = sql.all('SELECT * FROM findings WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC', c.tenantId, p.id).map(serializeFinding);
  const issues = sql.all('SELECT * FROM issue_reports WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC', c.tenantId, p.id);
  const appts = sql.all('SELECT a.*, u.name AS doctor FROM appointments a LEFT JOIN users u ON u.id = a.doctor_id WHERE a.tenant_id = ? AND a.patient_id = ? ORDER BY a.start_at DESC', c.tenantId, p.id);
  const rec = sql.get("SELECT * FROM appointment_recommendations WHERE tenant_id = ? AND patient_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1", c.tenantId, p.id);
  const wear = sql.all('SELECT date, hours FROM wear_logs WHERE tenant_id = ? AND patient_id = ? AND date >= ? ORDER BY date', c.tenantId, p.id, addDays(today(), -28));
  const refs = sql.all("SELECT * FROM images WHERE tenant_id = ? AND patient_id = ? AND owner_type = 'reference' ORDER BY view", c.tenantId, p.id);
  const decisions = sql.all('SELECT d.*, u.name AS by_name FROM decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE d.tenant_id = ? AND d.patient_id = ? ORDER BY d.decided_at DESC', c.tenantId, p.id);
  auditReq(req, 'patient.view', 'patient', p.id, { patientId: p.id });
  return {
    patient: patientSummary(c.tenantId, p),
    plan: bundle ? { ...bundle, totalStages: totalStages(bundle) } : null,
    checkins: checkins.map((x) => ({ id: x.id, status: x.status, stageNo: x.stage_no, submittedAt: x.submitted_at, reviewedAt: x.reviewed_at, priority: x.priority_score,
      gonogo: j.parse<{ recommendation?: string }>(x.gonogo_json, {}).recommendation ?? null, painLevel: x.pain_level, fit: x.fit, wear: x.wear_hours_bucket,
      imageCount: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM images WHERE owner_type = 'checkin' AND owner_id = ?", x.id)?.n ?? 0 })),
    findings,
    issues: issues.map((i) => ({ id: i.id, category: i.category, label: ISSUE_CATEGORIES[i.category as keyof typeof ISSUE_CATEGORIES], urgency: i.urgency, status: i.triage_status, details: i.details, createdAt: i.created_at, resolvedAt: i.resolved_at })),
    appointments: appts.map((a) => ({ id: a.id, startAt: a.start_at, durationMin: a.duration_min, type: a.type, status: a.status, doctor: a.doctor, notes: a.notes })),
    recommendation: rec ? serializeRec(rec) : null,
    nextCheckin: nextCheckinFor(c.tenantId, p.id),
    wear, referenceImages: refs.map(serializeImage),
    decisions: decisions.map((d) => ({ id: d.id, type: d.type, stageFrom: d.stage_from, stageTo: d.stage_to, holdDays: d.hold_days, message: d.message, decidedBy: d.by_name, decidedAt: d.decided_at, overrode: !!d.overrode_recommendation, checkinId: d.checkin_id })),
  };
}));

patientsRouter.patch('/patients/:id', requireStaff('patients.write'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const b = z.object({ status: z.enum(['invited', 'active', 'paused', 'completed', 'archived']).optional(), doctorId: z.string().optional(), protocolId: z.string().optional(),
    phone: z.string().optional(), email: z.string().optional(), consent: z.record(z.string(), z.boolean()).optional() }).parse(req.body);
  const p = sql.get('SELECT * FROM patients WHERE id = ?', req.params.id)!;
  const patch: Record<string, unknown> = {};
  if (b.status) patch.status = b.status;
  if (b.doctorId) patch.doctor_id = b.doctorId;
  if (b.protocolId) { if (!sql.get('SELECT id FROM protocols WHERE id = ? AND tenant_id = ?', b.protocolId, c.tenantId)) throw badRequest('Unknown protocol'); patch.protocol_id = b.protocolId; }
  if (b.phone !== undefined) patch.phone = b.phone;
  if (b.email !== undefined) patch.email = b.email;
  if (b.consent) patch.consent_json = j.str({ ...j.parse(p.consent_json, {}), ...b.consent, recorded_at: nowIso(), recorded_by: c.userId });
  sql.update('patients', p.id, c.tenantId, patch);
  if (b.status === 'archived') sql.run('UPDATE patient_devices SET revoked_at = ? WHERE patient_id = ? AND revoked_at IS NULL', nowIso(), p.id);
  auditReq(req, 'patient.update', 'patient', p.id, { patientId: p.id, meta: { fields: Object.keys(patch), consent: b.consent } });
  return patientSummary(c.tenantId, sql.get('SELECT * FROM patients WHERE id = ?', p.id));
}));

// ── Treatment plan ───────────────────────────────────────────────────────────
const PlanBody = z.object({
  system: z.string().max(80).default('Clear aligners'), totalUpper: z.number().int().min(1).max(99), totalLower: z.number().int().min(0).max(99),
  stageDays: z.number().int().min(3).max(30), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), currentStage: z.number().int().min(1).default(1),
  doctorInstructions: z.string().max(4000).optional(),
  attachments: z.array(z.object({ tooth: z.number().int().min(11).max(48), type: z.string(), surface: z.string().default('buccal'), placedStage: z.number().int().min(1).default(1), removedStage: z.number().int().nullable().optional() })).default([]),
  ipr: z.array(z.object({ toothA: z.number().int(), toothB: z.number().int(), amountMm: z.number().min(0.05).max(1), stage: z.number().int().min(1), status: z.enum(['planned', 'done', 'skipped']).default('planned') })).default([]),
  visits: z.array(z.object({ stage: z.number().int().min(1), reason: z.string(), procedures: z.array(z.string()).default([]) })).default([]),
  stageOverrides: z.array(z.object({ stage: z.number().int(), expectedChange: z.string() })).default([]),
});

patientsRouter.put('/patients/:id/plan', requireStaff('patients.write'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const b = PlanBody.parse(req.body);
  const total = Math.max(b.totalUpper, b.totalLower);
  if (b.currentStage > total) throw badRequest('Current stage exceeds total stages');
  const existing = activePlan(c.tenantId, req.params.id);
  const planId = newId('pln');
  const tags = parseInstructions(b.doctorInstructions);
  sql.tx(() => {
    if (existing) sql.update('treatment_plans', existing.id, c.tenantId, { status: 'superseded' });
    sql.insert('treatment_plans', { id: planId, tenant_id: c.tenantId, patient_id: req.params.id, system: b.system, total_upper: b.totalUpper, total_lower: b.totalLower,
      stage_days: b.stageDays, start_date: b.startDate, current_stage: b.currentStage, doctor_instructions: b.doctorInstructions ?? null, instruction_tags_json: j.str(tags), status: 'active', created_at: nowIso() });
    for (const s of generateStages(b.startDate, total, b.stageDays)) {
      const o = b.stageOverrides.find((x) => x.stage === s.stage_no);
      sql.insert('plan_stages', { id: newId('stg'), tenant_id: c.tenantId, plan_id: planId, stage_no: s.stage_no, expected_start: s.expected_start, expected_change: o?.expectedChange ?? s.expected_change,
        actual_start: s.stage_no < b.currentStage ? s.expected_start : s.stage_no === b.currentStage ? s.expected_start : null,
        status: s.stage_no < b.currentStage ? 'completed' : s.stage_no === b.currentStage ? 'active' : 'upcoming' });
    }
    for (const a of b.attachments) sql.insert('attachments', { id: newId('att'), tenant_id: c.tenantId, plan_id: planId, tooth_fdi: a.tooth, type: a.type, surface: a.surface, placed_stage: a.placedStage, removed_stage: a.removedStage ?? null });
    for (const i of b.ipr) sql.insert('ipr_events', { id: newId('ipr'), tenant_id: c.tenantId, plan_id: planId, tooth_a: i.toothA, tooth_b: i.toothB, amount_mm: i.amountMm, stage_no: i.stage, status: i.status });
    for (const v of b.visits) sql.insert('planned_visits', { id: newId('pv'), tenant_id: c.tenantId, plan_id: planId, stage_no: v.stage, reason: v.reason, procedures_json: j.str(v.procedures) });
  });
  auditReq(req, existing ? 'plan.replace' : 'plan.create', 'plan', planId, { patientId: req.params.id, meta: { total, stageDays: b.stageDays, tags: tags.length } });
  emit(c.tenantId, 'plan.updated', { patient_id: req.params.id, plan_id: planId });
  refreshRecommendation(c.tenantId, req.params.id);
  return { ...planBundle(c.tenantId, planId)!, totalStages: total, parsedTags: tags };
}));

patientsRouter.post('/instructions/parse', requireStaff('patients.read'), h((req) => {
  const b = z.object({ text: z.string().max(4000) }).parse(req.body);
  return { version: 'instr-parse-v1', tags: parseInstructions(b.text) };
}));

patientsRouter.patch('/ipr/:id', requireStaff('clinical.decide'), h((req) => {
  const c = staff(req);
  const b = z.object({ status: z.enum(['planned', 'done', 'skipped']) }).parse(req.body);
  const ev = sql.get('SELECT i.*, p.patient_id FROM ipr_events i JOIN treatment_plans p ON p.id = i.plan_id WHERE i.id = ? AND i.tenant_id = ?', req.params.id, c.tenantId);
  if (!ev) throw notFound('IPR event');
  assertPatientAccess(c, ev.patient_id);
  sql.update('ipr_events', ev.id, c.tenantId, { status: b.status, done_at: b.status === 'done' ? nowIso() : null, done_by: b.status === 'done' ? c.userId : null });
  auditReq(req, `ipr.${b.status}`, 'ipr', ev.id, { patientId: ev.patient_id });
  refreshRecommendation(c.tenantId, ev.patient_id);
  return { ok: true };
}));

patientsRouter.post('/patients/:id/reference-images', requireStaff('patients.write'), upload.single('image'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const view = z.enum(VIEWS).parse(req.body.view);
  if (!req.file) throw badRequest('Image file is required');
  const out = storeImage(req.file.buffer, { tenantId: c.tenantId, patientId: req.params.id, ownerType: 'reference', ownerId: null, view, withAligner: false, kind: 'baseline' });
  auditReq(req, 'reference_image.upload', 'image', out.id, { patientId: req.params.id, meta: { view } });
  return serializeImage(sql.get('SELECT * FROM images WHERE id = ?', out.id));
}));

patientsRouter.post('/patients/:id/invite', requireStaff('patients.write'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  // Human-friendly 8-character code, valid 7 days; only its hash is stored.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomToken(16);
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[bytes.charCodeAt(i) % alphabet.length];
  const t = sql.get('SELECT slug FROM tenants WHERE id = ?', c.tenantId)!;
  sql.update('patients', req.params.id, c.tenantId, { activation_code_hash: sha256(`${t.slug}:${code}`), activation_expires_at: addDays(today(), 7) + 'T23:59:59Z' });
  auditReq(req, 'patient.invite', 'patient', req.params.id, { patientId: req.params.id });
  return { clinicCode: t.slug, activationCode: code, expiresAt: addDays(today(), 7) };
}));

// ── Timeline ─────────────────────────────────────────────────────────────────
patientsRouter.get('/patients/:id/timeline', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const T = c.tenantId, P = req.params.id;
  const ev: { at: string; type: string; title: string; detail?: string; ref?: string; tone?: string; images?: string[] }[] = [];
  for (const x of sql.all('SELECT * FROM checkins WHERE tenant_id = ? AND patient_id = ? AND submitted_at IS NOT NULL', T, P)) {
    const imgs = sql.all("SELECT id FROM images WHERE owner_type = 'checkin' AND owner_id = ? ORDER BY view LIMIT 5", x.id).map((i) => i.id);
    ev.push({ at: x.submitted_at, type: 'checkin', title: `Check-in · aligner ${x.reported_aligner ?? x.stage_no ?? '?'}`, detail: `Wear ${x.wear_hours_bucket ?? 'n/a'} h · fit ${x.fit ?? 'n/a'}${x.pain_level ? ` · pain ${x.pain_level}/10` : ''}`, ref: x.id, tone: x.status === 'retake_requested' ? 'attention' : 'info', images: imgs });
  }
  for (const d of sql.all('SELECT d.*, u.name FROM decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE d.tenant_id = ? AND d.patient_id = ?', T, P)) {
    const title = { go: `Approved aligner ${d.stage_to}`, no_go: `Hold on aligner ${d.stage_from} (${d.hold_days} d)`, retake: 'Retake requested', visit: 'Visit requested' }[d.type as string] ?? d.type;
    ev.push({ at: d.decided_at, type: 'decision', title, detail: `${d.name}${d.overrode_recommendation ? ' · overrode recommendation' : ''}`, ref: d.checkin_id, tone: d.type === 'go' ? 'stable' : d.type === 'visit' ? 'attention' : 'info' });
  }
  for (const i of sql.all('SELECT * FROM issue_reports WHERE tenant_id = ? AND patient_id = ?', T, P))
    ev.push({ at: i.created_at, type: 'issue', title: ISSUE_CATEGORIES[i.category as keyof typeof ISSUE_CATEGORIES] ?? i.category, detail: `${i.urgency} · ${i.triage_status}${i.details ? ` · ${i.details}` : ''}`, ref: i.id, tone: i.urgency <= 'P2' ? 'urgent' : 'attention' });
  for (const a of sql.all('SELECT * FROM appointments WHERE tenant_id = ? AND patient_id = ?', T, P))
    ev.push({ at: a.start_at, type: 'appointment', title: `${a.type.replace(/_/g, ' ')} · ${a.duration_min} min`, detail: a.status, ref: a.id, tone: 'info' });
  for (const s of sql.all("SELECT s.* FROM plan_stages s JOIN treatment_plans p ON p.id = s.plan_id WHERE s.tenant_id = ? AND p.patient_id = ? AND p.status = 'active' AND s.actual_start IS NOT NULL", T, P))
    ev.push({ at: `${s.actual_start}T00:00:00Z`, type: 'stage', title: `Started aligner ${s.stage_no}`, tone: 'stable' });
  ev.sort((a, b) => b.at.localeCompare(a.at));
  return ev;
}));

// ── Messages ─────────────────────────────────────────────────────────────────
patientsRouter.get('/messages', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c);
  return sql.all(`SELECT p.id AS patient_id, p.first_name, p.last_name, p.avatar_hue, m.body, m.created_at, m.sender_type,
      (SELECT COUNT(*) FROM messages u WHERE u.patient_id = p.id AND u.sender_type = 'patient' AND u.read_at IS NULL) AS unread
    FROM patients p JOIN messages m ON m.id = (SELECT id FROM messages WHERE patient_id = p.id ORDER BY created_at DESC LIMIT 1)
    WHERE p.tenant_id = ? ${bf.clause} ORDER BY m.created_at DESC`, c.tenantId, ...bf.params)
    .map((r) => ({ patientId: r.patient_id, patientName: `${r.first_name} ${r.last_name}`, avatarHue: r.avatar_hue, lastMessage: r.body, lastAt: r.created_at, lastSender: r.sender_type, unread: r.unread }));
}));

patientsRouter.get('/patients/:id/messages', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  sql.run("UPDATE messages SET read_at = ? WHERE tenant_id = ? AND patient_id = ? AND sender_type = 'patient' AND read_at IS NULL", nowIso(), c.tenantId, req.params.id);
  return sql.all('SELECT m.*, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.tenant_id = ? AND m.patient_id = ? ORDER BY m.created_at', c.tenantId, req.params.id)
    .map((m) => ({ id: m.id, senderType: m.sender_type, senderName: m.sender_name, body: m.body, imageIds: j.parse(m.image_ids_json, []), automatedRule: m.automated_rule, createdAt: m.created_at, readAt: m.read_at }));
}));

patientsRouter.post('/patients/:id/messages', requireStaff('messages.send'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const b = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);
  const p = sql.get('SELECT consent_json FROM patients WHERE id = ?', req.params.id);
  if (!j.parse<Record<string, boolean>>(p?.consent_json, {}).messaging) throw new HttpError(409, 'Patient has not consented to secure messaging', 'no_consent');
  const id = staffMessage(c.tenantId, req.params.id, c.userId, b.body);
  auditReq(req, 'message.send', 'message', id, { patientId: req.params.id });
  return { id };
}));

// ── Triage ───────────────────────────────────────────────────────────────────
patientsRouter.get('/triage', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c);
  const includeResolved = req.query.resolved === '1';
  return sql.all(`SELECT i.*, p.first_name, p.last_name, p.avatar_hue, p.phone, u.name AS assignee FROM issue_reports i JOIN patients p ON p.id = i.patient_id LEFT JOIN users u ON u.id = i.assignee_id
    WHERE i.tenant_id = ? ${includeResolved ? '' : "AND i.triage_status != 'resolved'"} ${bf.clause} ORDER BY i.triage_status = 'resolved', i.urgency, i.created_at`, c.tenantId, ...bf.params)
    .map((i) => ({ id: i.id, patientId: i.patient_id, patientName: `${i.first_name} ${i.last_name}`, avatarHue: i.avatar_hue, phone: i.phone, category: i.category,
      label: ISSUE_CATEGORIES[i.category as keyof typeof ISSUE_CATEGORIES] ?? i.category, urgency: i.urgency, reasons: j.parse(i.urgency_reasons_json, []), details: i.details,
      painLevel: i.pain_level, status: i.triage_status, slaDueAt: i.sla_due_at, assignee: i.assignee, resolution: i.resolution, createdAt: i.created_at,
      images: sql.all("SELECT id FROM images WHERE owner_type = 'issue' AND owner_id = ?", i.id).map((x) => x.id) }));
}));

patientsRouter.post('/triage/:id', requireStaff('triage.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ action: z.enum(['acknowledge', 'assign_me', 'escalate', 'resolve', 'reopen']), resolution: z.string().max(2000).optional(), urgency: z.enum(['P1', 'P2', 'P3', 'P4']).optional() }).parse(req.body);
  const i = sql.get('SELECT * FROM issue_reports WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!i) throw notFound('Report');
  assertPatientAccess(c, i.patient_id);
  const patch: Record<string, unknown> = {};
  if (b.action === 'acknowledge') patch.triage_status = 'acknowledged';
  if (b.action === 'assign_me') { patch.assignee_id = c.userId; patch.triage_status = 'acknowledged'; }
  if (b.action === 'escalate') { patch.urgency = b.urgency ?? (i.urgency === 'P1' ? 'P1' : `P${Number(i.urgency[1]) - 1}`); }
  if (b.action === 'resolve') { patch.triage_status = 'resolved'; patch.resolution = b.resolution ?? null; patch.resolved_at = nowIso(); }
  if (b.action === 'reopen') { patch.triage_status = 'open'; patch.resolved_at = null; }
  sql.update('issue_reports', i.id, c.tenantId, patch);
  auditReq(req, `triage.${b.action}`, 'issue', i.id, { patientId: i.patient_id, meta: patch });
  refreshRecommendation(c.tenantId, i.patient_id);
  return { ok: true };
}));

void serializeImage; void hashPassword;
