import { sql, j } from '../db/db.js';
import { newId } from '../lib/ids.js';
import { addDays, daysBetween, hoursSince, nowIso, today } from '../lib/time.js';
import { activePlan, planBundle, daysOnStage, totalStages, type PlanBundle } from './plan.js';
import { DEFAULT_GO_CRITERIA, evaluateGoNoGo, wearFromBucket, type GoCriteria, type GoNoGoResult } from './scheduling/gonogo.js';
import { priorityScore } from './scheduling/priority.js';
import { parseInstructions } from './scheduling/instructionParser.js';
import { DEFAULT_RULES, findSlots, recommend, type EngineInput, type SchedulingRules } from './scheduling/appointmentEngine.js';
import { nextCheckin } from './scheduling/nextCheckin.js';
import { analyzeCheckin } from './observations/observationService.js';
import { systemMessage } from './messaging.js';
import { emit } from './webhooks.js';
import { VIEW_LABELS, type View } from './observations/schema.js';

export function tenantRules(tenantId: string): SchedulingRules {
  const t = sql.get('SELECT settings_json FROM tenants WHERE id = ?', tenantId);
  const s = j.parse<{ scheduling?: Partial<SchedulingRules> }>(t?.settings_json, {}).scheduling ?? {};
  return { ...DEFAULT_RULES, ...s, durations: { ...DEFAULT_RULES.durations, ...(s.durations ?? {}) } };
}

export interface ProtocolInfo { id: string; name: string; checkin_interval_days: number; grace_hours: number; required_views: { view: string; with_aligner: boolean }[]; go_criteria: GoCriteria }
export function protocolOf(tenantId: string, patientId: string): ProtocolInfo | null {
  const p = sql.get('SELECT pr.* FROM patients pa JOIN protocols pr ON pr.id = pa.protocol_id WHERE pa.id = ? AND pa.tenant_id = ?', patientId, tenantId);
  return p ? { ...p, required_views: j.parse<{ view: string; with_aligner: boolean }[]>(p.required_views_json, []), go_criteria: { ...DEFAULT_GO_CRITERIA, ...j.parse<Partial<GoCriteria>>(p.go_criteria_json, {}) } } : null;
}

export function wearMedian(tenantId: string, patientId: string, days = 7): number | null {
  const rows = sql.all<{ hours: number }>('SELECT hours FROM wear_logs WHERE tenant_id = ? AND patient_id = ? AND date >= ? ORDER BY hours', tenantId, patientId, addDays(today(), -days));
  if (!rows.length) return null;
  const m = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[m].hours : (rows[m - 1].hours + rows[m].hours) / 2;
}

/** Recomputes go/no-go and review priority for a check-in and stores them on the row. */
export function computeCheckinSignals(tenantId: string, checkinId: string): GoNoGoResult | null {
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', checkinId, tenantId);
  if (!chk) return null;
  const planRow = activePlan(tenantId, chk.patient_id);
  const bundle = planRow ? planBundle(tenantId, planRow.id) : null;
  const proto = protocolOf(tenantId, chk.patient_id);
  const images = sql.all("SELECT view, quality_status FROM images WHERE tenant_id = ? AND owner_type = 'checkin' AND owner_id = ?", tenantId, checkinId);
  const viewQuality: Record<string, string> = {};
  for (const i of images) {
    const rank = { usable: 2, limited: 1, unusable: 0 } as Record<string, number>;
    if (viewQuality[i.view] === undefined || rank[i.quality_status] > rank[viewQuality[i.view]]) viewQuality[i.view] = i.quality_status;
  }
  const findings = sql.all("SELECT * FROM findings WHERE tenant_id = ? AND checkin_id = ? AND status != 'dismissed'", tenantId, checkinId)
    .map((f) => ({ category: f.clinician_category ?? f.category, assessment: f.assessment, uncertainty: f.uncertainty, novelty: f.novelty, teeth: j.parse<number[]>(f.region_fdi_json, []), status: f.status }));
  const urgent = sql.all("SELECT urgency FROM issue_reports WHERE tenant_id = ? AND patient_id = ? AND triage_status != 'resolved' AND urgency IN ('P1','P2')", tenantId, chk.patient_id);
  const stage = bundle?.current_stage ?? chk.stage_no ?? 1;
  const ipr = bundle ? bundle.ipr.filter((x: any) => x.status === 'planned' && x.stage_no <= stage + 1) : [];
  const ai = j.parse<{ status?: string }>(chk.ai_status, {});
  const wear = wearMedian(tenantId, chk.patient_id) ?? wearFromBucket(chk.wear_hours_bucket);

  const result = evaluateGoNoGo({
    criteria: proto?.go_criteria ?? DEFAULT_GO_CRITERIA,
    daysOnStage: bundle ? daysOnStage(bundle) : 0, plannedStageDays: bundle?.stage_days ?? 14, currentStage: stage, totalStages: bundle ? totalStages(bundle) : stage,
    requiredViews: [...new Set((proto?.required_views ?? []).map((v) => v.view))], viewQuality,
    wearHours: wear, fit: chk.fit, findings, urgentOpenIssues: urgent.length,
    iprBeforeNextStage: ipr.map((x: any) => ({ teeth: `${x.tooth_a}/${x.tooth_b}`, amount: x.amount_mm, stage: x.stage_no })),
    aiStatus: ai.status ?? null,
  });

  const retakeLoops = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM decisions WHERE tenant_id = ? AND patient_id = ? AND type = 'retake' AND decided_at >= ?", tenantId, chk.patient_id, addDays(today(), -14))?.n ?? 0;
  const lastBefore = sql.get("SELECT submitted_at FROM checkins WHERE tenant_id = ? AND patient_id = ? AND id != ? AND submitted_at IS NOT NULL AND submitted_at < ? ORDER BY submitted_at DESC LIMIT 1", tenantId, chk.patient_id, checkinId, chk.submitted_at ?? nowIso());
  const overdue = lastBefore && proto ? Math.max(0, daysBetween(lastBefore.submitted_at.slice(0, 10), (chk.submitted_at ?? nowIso()).slice(0, 10)) - proto.checkin_interval_days - Math.round(proto.grace_hours / 24)) : 0;
  const pr = priorityScore({
    urgentIssue: urgent.some((u) => u.urgency === 'P1') ? 'P1' : urgent.length ? 'P2' : null,
    trackingGap: findings.some((f) => f.category === 'tracking_gap' && f.assessment === 'possible'),
    attachmentMissing: findings.some((f) => f.category === 'attachment_missing'),
    alignerDamage: findings.some((f) => f.category === 'aligner_damage'),
    retakeLoops, overdueDays: overdue, lowWear: wear != null && wear < (proto?.go_criteria.minWearHours ?? 20),
    ageHours: chk.submitted_at ? hoursSince(chk.submitted_at) : 0, painLevel: chk.pain_level ?? 0,
  });
  sql.update('checkins', checkinId, tenantId, { gonogo_json: j.str(result), priority_score: pr.score, priority_reasons_json: j.str(pr.reasons) });
  return result;
}

export function buildEngineInput(tenantId: string, patientId: string, bundle: PlanBundle): EngineInput {
  const stageChangeDates: Record<number, string> = {};
  for (const s of bundle.stages) stageChangeDates[s.stage_no] = s.expected_change;
  const lastVisit = sql.get("SELECT start_at FROM appointments WHERE tenant_id = ? AND patient_id = ? AND status = 'completed' ORDER BY start_at DESC LIMIT 1", tenantId, patientId);
  const upcoming = sql.get("SELECT start_at, type FROM appointments WHERE tenant_id = ? AND patient_id = ? AND status IN ('booked','requested') AND start_at >= ? ORDER BY start_at LIMIT 1", tenantId, patientId, today());
  const findings = sql.all("SELECT f.* FROM findings f WHERE f.tenant_id = ? AND f.patient_id = ? AND f.status IN ('open','confirmed','corrected') AND f.created_at >= ?", tenantId, patientId, addDays(today(), -30))
    .map((f) => ({ category: f.clinician_category ?? f.category, uncertainty: f.uncertainty, novelty: f.novelty, teeth: j.parse<number[]>(f.region_fdi_json, []), assessment: f.status === 'confirmed' ? 'possible' : f.assessment }));
  const issues = sql.all("SELECT category FROM issue_reports WHERE tenant_id = ? AND patient_id = ? AND triage_status != 'resolved'", tenantId, patientId);
  const lastChk = sql.get("SELECT id, fit FROM checkins WHERE tenant_id = ? AND patient_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1", tenantId, patientId);
  const poorFit = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM checkins WHERE tenant_id = ? AND patient_id = ? AND fit = 'poor' AND submitted_at >= ?", tenantId, patientId, addDays(today(), -21))?.n ?? 0;
  const lastQ = lastChk ? sql.all("SELECT quality_status FROM images WHERE tenant_id = ? AND owner_type = 'checkin' AND owner_id = ?", tenantId, lastChk.id).map((r) => r.quality_status) : [];
  const wear = wearMedian(tenantId, patientId, 14);
  return {
    today: today(), currentStage: bundle.current_stage, totalStages: totalStages(bundle), stageDays: bundle.stage_days, stageChangeDates,
    lastVisitDate: lastVisit?.start_at.slice(0, 10) ?? bundle.start_date,
    plannedVisits: bundle.visits.map((v: any) => ({ stage: v.stage_no, reason: v.reason, procedures: v.procedures })),
    iprPlanned: bundle.ipr.filter((x: any) => x.status === 'planned').map((x: any) => ({ teeth: [x.tooth_a, x.tooth_b] as [number, number], amountMm: x.amount_mm, stage: x.stage_no })),
    tags: j.parse(bundle.instruction_tags_json, []).length ? j.parse(bundle.instruction_tags_json, []) : parseInstructions(bundle.doctor_instructions),
    findings,
    patientReportedAttachmentOff: issues.filter((i) => i.category === 'attachment_off').length,
    patientReportedRepair: issues.filter((i) => i.category === 'bracket_loose' || i.category === 'wire_poking').length,
    poorFitReports: poorFit + issues.filter((i) => i.category === 'poor_fit').length,
    complianceLowWear: wear != null && wear < 20,
    lastQuality: lastQ.includes('unusable') ? 'unusable' : lastQ.includes('limited') ? 'limited' : lastQ.length ? 'usable' : null,
    alreadyBooked: upcoming ? { date: upcoming.start_at, type: upcoming.type } : null,
    rules: tenantRules(tenantId),
  };
}

/** Produces (or refreshes) the proposed appointment recommendation for a patient, including concrete slot suggestions. */
export function refreshRecommendation(tenantId: string, patientId: string, checkinId: string | null = null) {
  const planRow = activePlan(tenantId, patientId);
  if (!planRow) return null;
  const bundle = planBundle(tenantId, planRow.id)!;
  const input = buildEngineInput(tenantId, patientId, bundle);
  const rec = recommend(input);
  sql.run("DELETE FROM appointment_recommendations WHERE tenant_id = ? AND patient_id = ? AND status = 'proposed'", tenantId, patientId);
  if (!rec.needed) return { ...rec, id: null, slots: [] };
  const pat = sql.get('SELECT doctor_id, branch_id FROM patients WHERE id = ? AND tenant_id = ?', patientId, tenantId)!;
  const branch = sql.get('SELECT chairs FROM branches WHERE id = ? AND tenant_id = ?', pat.branch_id, tenantId);
  const slots = findSlots({
    from: rec.earliest, to: addDays(rec.latest, 10), durationMin: rec.durationMin, doctorId: pat.doctor_id, chairs: branch?.chairs ?? 2,
    availability: sql.all('SELECT * FROM availability WHERE tenant_id = ? AND branch_id = ?', tenantId, pat.branch_id).map((a) => ({ doctorId: a.doctor_id, weekday: a.weekday, start: a.start_time, end: a.end_time })),
    booked: sql.all("SELECT doctor_id, chair, start_at, duration_min FROM appointments WHERE tenant_id = ? AND branch_id = ? AND status IN ('booked','requested') AND start_at >= ?", tenantId, pat.branch_id, rec.earliest)
      .map((b) => ({ doctorId: b.doctor_id, chair: b.chair, start: b.start_at, durationMin: b.duration_min })),
    rules: input.rules, limit: 3, notBefore: rec.target > today() ? undefined : `${today()}T${new Date().toISOString().slice(11, 16)}`,
  });
  const doc = sql.get('SELECT name FROM users WHERE id = ?', pat.doctor_id);
  const factors = [...rec.factors];
  if (slots[0]) factors.push({ text: `Next free ${rec.durationMin}-min slot with ${doc?.name ?? 'treating doctor'}: ${slots[0].start.replace('T', ' ')}`, basis: 'availability' });
  else factors.push({ text: `No free ${rec.durationMin}-min slot with ${doc?.name ?? 'the treating doctor'} in the window: consider another doctor or extending hours`, basis: 'availability' });
  const id = newId('rec');
  sql.insert('appointment_recommendations', {
    id, tenant_id: tenantId, patient_id: patientId, checkin_id: checkinId, kind: rec.kind, earliest: rec.earliest, latest: rec.latest, target_date: rec.target,
    duration_min: rec.durationMin, uncertainty: rec.uncertainty, factors_json: j.str({ label: rec.label, factors, alreadyBooked: rec.alreadyBooked }), slot_json: j.str(slots),
    engine_version: rec.version, status: 'proposed', created_at: nowIso(),
  });
  emit(tenantId, 'appointment.recommended', { recommendation_id: id, patient_id: patientId, kind: rec.kind, earliest: rec.earliest, latest: rec.latest, duration_min: rec.durationMin });
  return { ...rec, factors, id, slots };
}

export function nextCheckinFor(tenantId: string, patientId: string) {
  const proto = protocolOf(tenantId, patientId);
  const last = sql.get("SELECT submitted_at FROM checkins WHERE tenant_id = ? AND patient_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1", tenantId, patientId);
  const planRow = activePlan(tenantId, patientId);
  const bundle = planRow ? planBundle(tenantId, planRow.id) : null;
  const decisions = sql.all("SELECT type, hold_days FROM decisions WHERE tenant_id = ? AND patient_id = ? ORDER BY decided_at DESC LIMIT 5", tenantId, patientId);
  let clean = 0; for (const d of decisions) { if (d.type === 'go') clean++; else break; }
  const current = bundle?.stages.find((s: any) => s.stage_no === bundle.current_stage);
  return nextCheckin({
    lastCheckin: last?.submitted_at.slice(0, 10) ?? today(), intervalDays: proto?.checkin_interval_days ?? 7, nextChangeDate: current?.expected_change ?? null,
    lastDecision: decisions[0]?.type ?? null, holdDays: decisions[0]?.hold_days ?? 0, consecutiveCleanGo: clean,
    lowWearStreak: (wearMedian(tenantId, patientId, 14) ?? 24) < 20 ? 2 : 0, today: today(),
  });
}

/** Called when the patient app submits a check-in (after all images are uploaded). */
export async function processSubmission(tenantId: string, checkinId: string) {
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', checkinId, tenantId)!;
  const proto = protocolOf(tenantId, chk.patient_id);
  const images = sql.all("SELECT view, quality_status, quality_json FROM images WHERE tenant_id = ? AND owner_type = 'checkin' AND owner_id = ?", tenantId, checkinId);
  const required = [...new Set((proto?.required_views ?? []).map((v) => v.view))];
  const bad = required.filter((v) => !images.some((i) => i.view === v && i.quality_status !== 'unusable'));
  sql.update('checkins', checkinId, tenantId, { status: 'quality_check', submitted_at: chk.submitted_at ?? nowIso() });
  emit(tenantId, 'checkin.submitted', { checkin_id: checkinId, patient_id: chk.patient_id });

  if (bad.length) {
    // Automatic, non-clinical: request a retake of the specific views with the quality service's reason.
    const tips = bad.map((v) => {
      const q = images.find((i) => i.view === v);
      const tip = q ? j.parse<{ retakeTip?: string }>(q.quality_json, {}).retakeTip : 'Photo missing';
      return `${VIEW_LABELS[v as View] ?? v}: ${tip ?? 'please retake'}`;
    });
    sql.update('checkins', checkinId, tenantId, { status: 'retake_requested' });
    systemMessage(tenantId, chk.patient_id, `Thanks for your check-in! A few photos weren't clear enough for your clinician to compare:\n${tips.join('\n')}\nPlease retake just those views from the Home screen.`, 'retake_quality');
    computeCheckinSignals(tenantId, checkinId);
    return { status: 'retake_requested', views: bad };
  }
  sql.update('checkins', checkinId, tenantId, { status: 'awaiting_review' });
  systemMessage(tenantId, chk.patient_id, 'Your check-in was received and is waiting for your orthodontist to review it. Keep wearing your current aligner until you hear back.', 'checkin_received');
  computeCheckinSignals(tenantId, checkinId);
  // AI observations run asynchronously; the review never blocks on them.
  analyzeCheckin(tenantId, checkinId)
    .then(() => { computeCheckinSignals(tenantId, checkinId); refreshRecommendation(tenantId, chk.patient_id, checkinId); })
    .catch((e) => console.error('analyzeCheckin failed', e));
  refreshRecommendation(tenantId, chk.patient_id, checkinId);
  return { status: 'awaiting_review', views: [] };
}
