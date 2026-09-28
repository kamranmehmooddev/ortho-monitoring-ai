import { Router } from 'express';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addDays, nowIso, today } from '../lib/time.js';
import { assertPatientAccess, branchFilter, requireStaff, staff } from '../security/auth.js';
import { auditReq } from '../services/audit.js';
import { refreshRecommendation, tenantRules } from '../services/review.js';
import { findSlots, VISIT_LABELS } from '../services/scheduling/appointmentEngine.js';
import { systemMessage } from '../services/messaging.js';
import { emit } from '../services/webhooks.js';
import { serializeRec } from './review.js';

export const schedulingRouter = Router();

schedulingRouter.get('/appointments', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c, 'a');
  const from = String(req.query.from ?? today());
  const to = String(req.query.to ?? addDays(from, 7));
  return sql.all(`SELECT a.*, p.first_name, p.last_name, p.avatar_hue, u.name AS doctor FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN users u ON u.id = a.doctor_id
    WHERE a.tenant_id = ? AND a.start_at >= ? AND a.start_at < ? AND a.status != 'cancelled' ${bf.clause} ORDER BY a.start_at`, c.tenantId, from, to, ...bf.params)
    .map((a) => ({ id: a.id, patientId: a.patient_id, patientName: `${a.first_name} ${a.last_name}`, avatarHue: a.avatar_hue, doctorId: a.doctor_id, doctor: a.doctor,
      branchId: a.branch_id, chair: a.chair, startAt: a.start_at, durationMin: a.duration_min, type: a.type, typeLabel: VISIT_LABELS[a.type as keyof typeof VISIT_LABELS] ?? a.type,
      status: a.status, notes: a.notes, recommendationId: a.recommendation_id }));
}));

const ApptBody = z.object({
  patientId: z.string(), doctorId: z.string().optional(), branchId: z.string().optional(), chair: z.number().int().min(1).max(20).default(1),
  startAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), durationMin: z.number().int().min(5).max(240), type: z.string(), notes: z.string().max(1000).optional(),
  recommendationId: z.string().optional(),
});

schedulingRouter.post('/appointments', requireStaff('appointments.book'), h((req) => {
  const c = staff(req);
  const b = ApptBody.parse(req.body);
  assertPatientAccess(c, b.patientId);
  const p = sql.get('SELECT * FROM patients WHERE id = ?', b.patientId)!;
  const branchId = b.branchId ?? p.branch_id;
  const doctorId = b.doctorId ?? p.doctor_id;
  const clash = sql.get(`SELECT id FROM appointments WHERE tenant_id = ? AND status IN ('booked','requested') AND substr(start_at,1,10) = ? AND (doctor_id = ? OR (branch_id = ? AND chair = ?))
    AND start_at < ? AND datetime(start_at, '+' || duration_min || ' minutes') > datetime(?)`, c.tenantId, b.startAt.slice(0, 10), doctorId, branchId, b.chair,
    new Date(new Date(`${b.startAt}:00Z`).getTime() + b.durationMin * 60000).toISOString().slice(0, 16), b.startAt);
  if (clash) throw badRequest('That time overlaps another appointment for this doctor or chair');
  const id = newId('apt');
  sql.tx(() => {
    // Replace an outstanding "requested" appointment for this patient with the confirmed booking.
    sql.run("UPDATE appointments SET status = 'cancelled', notes = coalesce(notes,'') || ' (superseded by booking)' WHERE tenant_id = ? AND patient_id = ? AND status = 'requested'", c.tenantId, b.patientId);
    sql.insert('appointments', { id, tenant_id: c.tenantId, branch_id: branchId, patient_id: b.patientId, doctor_id: doctorId, chair: b.chair, start_at: b.startAt, duration_min: b.durationMin,
      type: b.type, status: 'booked', recommendation_id: b.recommendationId ?? null, notes: b.notes ?? null, created_at: nowIso() });
    if (b.recommendationId) {
      const r = sql.get('SELECT * FROM appointment_recommendations WHERE id = ? AND tenant_id = ?', b.recommendationId, c.tenantId);
      if (r) sql.update('appointment_recommendations', r.id, c.tenantId, {
        status: r.duration_min === b.durationMin && b.startAt.slice(0, 10) >= r.earliest && b.startAt.slice(0, 10) <= addDays(r.latest, 10) ? 'accepted' : 'edited',
        final_date: b.startAt, final_duration: b.durationMin, decided_by: c.userId, decided_at: nowIso() });
    }
  });
  const label = VISIT_LABELS[b.type as keyof typeof VISIT_LABELS] ?? b.type;
  systemMessage(c.tenantId, b.patientId, `Your ${label.toLowerCase()} is booked for ${b.startAt.replace('T', ' at ')} (${b.durationMin} min).`, 'decision', c.userId);
  auditReq(req, 'appointment.book', 'appointment', id, { patientId: b.patientId, meta: { startAt: b.startAt, durationMin: b.durationMin, type: b.type, recommendationId: b.recommendationId } });
  emit(c.tenantId, 'appointment.booked', { appointment_id: id, patient_id: b.patientId, start_at: b.startAt, duration_min: b.durationMin, type: b.type });
  return { id };
}));

schedulingRouter.patch('/appointments/:id', requireStaff('appointments.book'), h((req) => {
  const c = staff(req);
  const b = z.object({ status: z.enum(['booked', 'completed', 'cancelled', 'no_show']).optional(), startAt: z.string().optional(), durationMin: z.number().int().min(5).max(240).optional(), chair: z.number().int().optional(), notes: z.string().optional() }).parse(req.body);
  const a = sql.get('SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!a) throw notFound('Appointment');
  assertPatientAccess(c, a.patient_id);
  const patch: Record<string, unknown> = {};
  if (b.status) patch.status = b.status;
  if (b.startAt) patch.start_at = b.startAt;
  if (b.durationMin) patch.duration_min = b.durationMin;
  if (b.chair) patch.chair = b.chair;
  if (b.notes !== undefined) patch.notes = b.notes;
  sql.update('appointments', a.id, c.tenantId, patch);
  auditReq(req, 'appointment.update', 'appointment', a.id, { patientId: a.patient_id, meta: patch });
  emit(c.tenantId, 'appointment.updated', { appointment_id: a.id, patient_id: a.patient_id, ...patch });
  if (b.status === 'completed') refreshRecommendation(c.tenantId, a.patient_id);
  return { ok: true };
}));

schedulingRouter.get('/recommendations', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c);
  return sql.all(`SELECT r.*, p.first_name, p.last_name, p.avatar_hue FROM appointment_recommendations r JOIN patients p ON p.id = r.patient_id
    WHERE r.tenant_id = ? AND r.status = 'proposed' ${bf.clause} ORDER BY r.latest`, c.tenantId, ...bf.params)
    .map((r) => ({ ...serializeRec(r), patientName: `${r.first_name} ${r.last_name}`, avatarHue: r.avatar_hue }));
}));

schedulingRouter.post('/patients/:id/recommendation/refresh', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  assertPatientAccess(c, req.params.id);
  const r = refreshRecommendation(c.tenantId, req.params.id);
  const row = r?.id ? sql.get('SELECT * FROM appointment_recommendations WHERE id = ?', r.id) : null;
  return row ? serializeRec(row) : { needed: false, factors: r?.factors ?? [] };
}));

schedulingRouter.post('/recommendations/:id', requireStaff('appointments.book'), h((req) => {
  const c = staff(req);
  const b = z.object({ action: z.enum(['dismiss', 'edit']), reason: z.string().max(500).optional(), date: z.string().optional(), durationMin: z.number().int().min(5).max(240).optional() }).parse(req.body);
  const r = sql.get('SELECT * FROM appointment_recommendations WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!r) throw notFound('Recommendation');
  assertPatientAccess(c, r.patient_id);
  if (b.action === 'dismiss') sql.update('appointment_recommendations', r.id, c.tenantId, { status: 'dismissed', decided_by: c.userId, decided_at: nowIso() });
  else sql.update('appointment_recommendations', r.id, c.tenantId, { target_date: b.date ?? r.target_date, final_date: b.date ?? r.target_date, final_duration: b.durationMin ?? r.duration_min, duration_min: r.duration_min });
  auditReq(req, `recommendation.${b.action}`, 'recommendation', r.id, { patientId: r.patient_id, meta: b });
  return { ok: true };
}));

/** Slot search for the calendar ("find me 30 min with Dr X in the next 2 weeks"). */
schedulingRouter.get('/slots', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const q = z.object({ patientId: z.string(), durationMin: z.coerce.number().int().min(5).max(240), from: z.string().optional(), to: z.string().optional(), doctorId: z.string().optional() }).parse(req.query);
  assertPatientAccess(c, q.patientId);
  const p = sql.get('SELECT * FROM patients WHERE id = ?', q.patientId)!;
  const from = q.from ?? today();
  const branch = sql.get('SELECT chairs FROM branches WHERE id = ?', p.branch_id);
  return findSlots({ from, to: q.to ?? addDays(from, 21), durationMin: q.durationMin, doctorId: q.doctorId ?? p.doctor_id, chairs: branch?.chairs ?? 2,
    availability: sql.all('SELECT * FROM availability WHERE tenant_id = ? AND branch_id = ?', c.tenantId, p.branch_id).map((a) => ({ doctorId: a.doctor_id, weekday: a.weekday, start: a.start_time, end: a.end_time })),
    booked: sql.all("SELECT doctor_id, chair, start_at, duration_min FROM appointments WHERE tenant_id = ? AND branch_id = ? AND status IN ('booked','requested') AND start_at >= ?", c.tenantId, p.branch_id, from)
      .map((b) => ({ doctorId: b.doctor_id, chair: b.chair, start: b.start_at, durationMin: b.duration_min })),
    rules: tenantRules(c.tenantId), limit: 6 });
}));

schedulingRouter.get('/availability', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  return sql.all('SELECT a.*, u.name AS doctor FROM availability a JOIN users u ON u.id = a.doctor_id WHERE a.tenant_id = ? ORDER BY a.doctor_id, a.weekday, a.start_time', c.tenantId)
    .map((a) => ({ id: a.id, doctorId: a.doctor_id, doctor: a.doctor, branchId: a.branch_id, weekday: a.weekday, start: a.start_time, end: a.end_time }));
}));

schedulingRouter.put('/availability/:doctorId', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.array(z.object({ branchId: z.string(), weekday: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })).parse(req.body);
  if (!sql.get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', req.params.doctorId, c.tenantId)) throw notFound('Doctor');
  sql.tx(() => {
    sql.run('DELETE FROM availability WHERE tenant_id = ? AND doctor_id = ?', c.tenantId, req.params.doctorId);
    for (const a of b) sql.insert('availability', { id: newId('avl'), tenant_id: c.tenantId, doctor_id: req.params.doctorId, branch_id: a.branchId, weekday: a.weekday, start_time: a.start, end_time: a.end });
  });
  auditReq(req, 'availability.update', 'user', req.params.doctorId);
  return { ok: true };
}));

void j;
