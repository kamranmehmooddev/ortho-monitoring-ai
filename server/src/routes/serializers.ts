import { sql, j } from '../db/db.js';
import { CATEGORY_LABELS, type FindingCategory } from '../services/observations/schema.js';
import { activePlan, planBundle, daysOnStage, totalStages } from '../services/plan.js';

export const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;

export function serializeFinding(f: any) {
  const cat = (f.clinician_category ?? f.category) as FindingCategory;
  return {
    id: f.id, checkinId: f.checkin_id, patientId: f.patient_id, source: f.source, category: f.category, clinicianCategory: f.clinician_category,
    label: CATEGORY_LABELS[cat] ?? cat, teeth: j.parse<number[]>(f.region_fdi_json, []), view: f.view, imageId: f.image_id, bbox: j.parse(f.bbox_json, null),
    assessment: f.assessment, novelty: f.novelty, uncertainty: f.uncertainty, confidence: f.confidence, evidence: f.evidence, needsBetterImage: !!f.needs_better_image,
    modelVersion: f.model_version, promptVersion: f.prompt_version, qualityBand: f.quality_band, status: f.status, clinicianNote: f.clinician_note,
    reviewedBy: f.reviewed_by, reviewedAt: f.reviewed_at, createdAt: f.created_at,
  };
}

export function patientSummary(tenantId: string, p: any) {
  const planRow = activePlan(tenantId, p.id);
  const bundle = planRow ? planBundle(tenantId, planRow.id) : null;
  const stage = bundle?.stages.find((s: any) => s.stage_no === bundle.current_stage);
  const lastChk = sql.get('SELECT id, status, submitted_at FROM checkins WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC LIMIT 1', tenantId, p.id);
  const doctor = p.doctor_id ? sql.get('SELECT name FROM users WHERE id = ?', p.doctor_id) : null;
  const branch = sql.get('SELECT name FROM branches WHERE id = ?', p.branch_id);
  const protocol = p.protocol_id ? sql.get('SELECT name, checkin_interval_days FROM protocols WHERE id = ?', p.protocol_id) : null;
  return {
    id: p.id, name: fullName(p), firstName: p.first_name, lastName: p.last_name, dob: p.dob, email: p.email, phone: p.phone, mode: p.mode, status: p.status,
    avatarHue: p.avatar_hue, branchId: p.branch_id, branchName: branch?.name, doctorId: p.doctor_id, doctorName: doctor?.name, protocolId: p.protocol_id, protocolName: protocol?.name,
    checkinIntervalDays: protocol?.checkin_interval_days, externalRef: p.external_ref, consent: j.parse(p.consent_json, {}), guardian: j.parse(p.guardian_json, null),
    plan: bundle ? { id: bundle.id, system: bundle.system, currentStage: bundle.current_stage, totalStages: totalStages(bundle), stageDays: bundle.stage_days,
      daysOnStage: daysOnStage(bundle), nextChange: stage?.expected_change ?? null, startDate: bundle.start_date } : null,
    lastCheckin: lastChk ? { id: lastChk.id, status: lastChk.status, submittedAt: lastChk.submitted_at } : null,
    createdAt: p.created_at,
  };
}
