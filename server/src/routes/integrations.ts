import { Router } from 'express';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { nowIso, today, addDays } from '../lib/time.js';
import { apiKey } from '../security/auth.js';
import { auditReq } from '../services/audit.js';
import { emit } from '../services/webhooks.js';
import { generateStages } from '../services/plan.js';
import { parseInstructions } from '../services/scheduling/instructionParser.js';
import { refreshRecommendation } from '../services/review.js';

/**
 * Integration API for practice-management systems and aligner treatment-plan viewers (API-key auth, scoped).
 * Returns ids and clinical metadata only: images are never exposed through the integration API.
 */
export const integrationsRouter = Router();

integrationsRouter.get('/patients', h((req) => {
  const k = apiKey(req, 'patients:read');
  const ref = req.query.external_ref ? String(req.query.external_ref) : null;
  return sql.all(`SELECT id, first_name, last_name, dob, external_ref, status, branch_id, created_at FROM patients WHERE tenant_id = ? ${ref ? 'AND external_ref = ?' : ''} ORDER BY created_at DESC LIMIT 500`, k.tenantId, ...(ref ? [ref] : []))
    .map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name, dob: p.dob, external_ref: p.external_ref, status: p.status, branch_id: p.branch_id, created_at: p.created_at }));
}));

integrationsRouter.post('/patients', h((req) => {
  const k = apiKey(req, 'patients:write');
  const b = z.object({ first_name: z.string(), last_name: z.string(), dob: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), external_ref: z.string(),
    branch_id: z.string().optional(), doctor_id: z.string().optional(), protocol_id: z.string().optional(),
    consent: z.object({ photos: z.boolean(), ai_processing: z.boolean(), messaging: z.boolean(), research: z.boolean().default(false) }) }).parse(req.body);
  const existing = sql.get('SELECT id FROM patients WHERE tenant_id = ? AND external_ref = ?', k.tenantId, b.external_ref);
  if (existing) return { id: existing.id, created: false };
  const branch = b.branch_id ?? sql.get('SELECT id FROM branches WHERE tenant_id = ? ORDER BY name LIMIT 1', k.tenantId)?.id;
  const doctor = b.doctor_id ?? sql.get("SELECT id FROM users WHERE tenant_id = ? AND role = 'orthodontist' LIMIT 1", k.tenantId)?.id;
  const protocol = b.protocol_id ?? sql.get('SELECT id FROM protocols WHERE tenant_id = ? ORDER BY name LIMIT 1', k.tenantId)?.id;
  if (!branch || !doctor || !protocol) throw badRequest('Clinic is missing a branch, doctor or protocol');
  const id = newId('pat');
  sql.insert('patients', { id, tenant_id: k.tenantId, branch_id: branch, doctor_id: doctor, first_name: b.first_name, last_name: b.last_name, dob: b.dob ?? null, email: b.email ?? null, phone: b.phone ?? null,
    mode: 'aligner', protocol_id: protocol, status: 'invited', consent_json: j.str({ ...b.consent, recorded_at: nowIso(), recorded_by: `api_key:${k.keyId}` }), external_ref: b.external_ref, avatar_hue: 200, created_at: nowIso() });
  auditReq(req, 'patient.create', 'patient', id, { patientId: id });
  emit(k.tenantId, 'patient.created', { patient_id: id, external_ref: b.external_ref });
  return { id, created: true };
}));

/** Treatment-plan viewer import: stages, attachments, IPR and planned visits in one call. */
integrationsRouter.put('/patients/:id/plan', h((req) => {
  const k = apiKey(req, 'plans:write');
  const p = sql.get('SELECT id FROM patients WHERE id = ? AND tenant_id = ?', req.params.id, k.tenantId);
  if (!p) throw notFound('Patient');
  const b = z.object({ system: z.string(), total_upper: z.number().int(), total_lower: z.number().int(), stage_days: z.number().int(), start_date: z.string(), doctor_instructions: z.string().optional(),
    attachments: z.array(z.object({ tooth: z.number().int(), type: z.string(), placed_stage: z.number().int().default(1) })).default([]),
    ipr: z.array(z.object({ tooth_a: z.number().int(), tooth_b: z.number().int(), amount_mm: z.number(), stage: z.number().int() })).default([]) }).parse(req.body);
  const total = Math.max(b.total_upper, b.total_lower);
  const planId = newId('pln');
  sql.tx(() => {
    sql.run("UPDATE treatment_plans SET status = 'superseded' WHERE tenant_id = ? AND patient_id = ? AND status = 'active'", k.tenantId, p.id);
    sql.insert('treatment_plans', { id: planId, tenant_id: k.tenantId, patient_id: p.id, system: b.system, total_upper: b.total_upper, total_lower: b.total_lower, stage_days: b.stage_days, start_date: b.start_date,
      current_stage: 1, doctor_instructions: b.doctor_instructions ?? null, instruction_tags_json: j.str(parseInstructions(b.doctor_instructions)), status: 'active', created_at: nowIso() });
    for (const s of generateStages(b.start_date, total, b.stage_days)) sql.insert('plan_stages', { id: newId('stg'), tenant_id: k.tenantId, plan_id: planId, ...s, status: s.stage_no === 1 ? 'active' : 'upcoming', actual_start: s.stage_no === 1 ? b.start_date : null });
    for (const a of b.attachments) sql.insert('attachments', { id: newId('att'), tenant_id: k.tenantId, plan_id: planId, tooth_fdi: a.tooth, type: a.type, surface: 'buccal', placed_stage: a.placed_stage });
    for (const i of b.ipr) sql.insert('ipr_events', { id: newId('ipr'), tenant_id: k.tenantId, plan_id: planId, tooth_a: i.tooth_a, tooth_b: i.tooth_b, amount_mm: i.amount_mm, stage_no: i.stage, status: 'planned' });
  });
  auditReq(req, 'plan.import', 'plan', planId, { patientId: p.id });
  emit(k.tenantId, 'plan.updated', { patient_id: p.id, plan_id: planId });
  refreshRecommendation(k.tenantId, p.id);
  return { plan_id: planId, stages: total };
}));

integrationsRouter.get('/appointments', h((req) => {
  const k = apiKey(req, 'appointments:read');
  const from = String(req.query.from ?? today()), to = String(req.query.to ?? addDays(from, 30));
  return sql.all("SELECT a.*, p.external_ref FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.tenant_id = ? AND a.start_at >= ? AND a.start_at < ? ORDER BY a.start_at", k.tenantId, from, to)
    .map((a) => ({ id: a.id, patient_id: a.patient_id, external_ref: a.external_ref, start_at: a.start_at, duration_min: a.duration_min, type: a.type, status: a.status, recommendation_id: a.recommendation_id }));
}));

integrationsRouter.get('/recommendations', h((req) => {
  const k = apiKey(req, 'appointments:read');
  return sql.all("SELECT r.*, p.external_ref FROM appointment_recommendations r JOIN patients p ON p.id = r.patient_id WHERE r.tenant_id = ? AND r.status = 'proposed'", k.tenantId)
    .map((r) => ({ id: r.id, patient_id: r.patient_id, external_ref: r.external_ref, kind: r.kind, earliest: r.earliest, latest: r.latest, target_date: r.target_date, duration_min: r.duration_min, uncertainty: r.uncertainty, factors: j.parse<any>(r.factors_json, {}).factors }));
}));

integrationsRouter.get('/decisions', h((req) => {
  const k = apiKey(req, 'decisions:read');
  const since = String(req.query.since ?? addDays(today(), -7));
  return sql.all('SELECT d.*, p.external_ref FROM decisions d JOIN patients p ON p.id = d.patient_id WHERE d.tenant_id = ? AND d.decided_at >= ? ORDER BY d.decided_at', k.tenantId, since)
    .map((d) => ({ id: d.id, patient_id: d.patient_id, external_ref: d.external_ref, checkin_id: d.checkin_id, type: d.type, stage_from: d.stage_from, stage_to: d.stage_to, hold_days: d.hold_days, decided_at: d.decided_at }));
}));

integrationsRouter.get('/checkins', h((req) => {
  const k = apiKey(req, 'checkins:read');
  const since = String(req.query.since ?? addDays(today(), -7));
  return sql.all('SELECT c.*, p.external_ref FROM checkins c JOIN patients p ON p.id = c.patient_id WHERE c.tenant_id = ? AND c.created_at >= ? ORDER BY c.created_at', k.tenantId, since)
    .map((c) => ({ id: c.id, patient_id: c.patient_id, external_ref: c.external_ref, status: c.status, stage: c.stage_no, submitted_at: c.submitted_at, reviewed_at: c.reviewed_at }));
}));
