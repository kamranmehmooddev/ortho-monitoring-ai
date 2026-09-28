import { Router } from 'express';
import { z } from 'zod';
import { sql, j, VIEW_ORDER } from '../db/db.js';
import { h, badRequest, notFound, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addDays, daysBetween, hoursSince, nowIso, today } from '../lib/time.js';
import { assertPatientAccess, branchFilter, requireStaff, staff } from '../security/auth.js';
import { auditReq } from '../services/audit.js';
import { getBlob } from '../services/storage.js';
import { serializeImage } from '../services/images.js';
import { activePlan, planBundle, daysOnStage, totalStages } from '../services/plan.js';
import { computeCheckinSignals, nextCheckinFor, protocolOf, refreshRecommendation, wearMedian } from '../services/review.js';
import { analyzeCheckin } from '../services/observations/observationService.js';
import { FINDING_CATEGORIES, VIEWS } from '../services/observations/schema.js';
import { systemMessage } from '../services/messaging.js';
import { emit } from '../services/webhooks.js';
import { fullName, patientSummary, serializeFinding } from './serializers.js';
import { can } from '../security/rbac.js';

export const reviewRouter = Router();

// ── Dashboard ────────────────────────────────────────────────────────────────
reviewRouter.get('/dashboard', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c);
  const T = c.tenantId;
  const awaiting = sql.all(`SELECT ch.*, p.first_name, p.last_name, p.avatar_hue FROM checkins ch JOIN patients p ON p.id = ch.patient_id
    WHERE ch.tenant_id = ? AND ch.status = 'awaiting_review' ${bf.clause} ORDER BY ch.priority_score DESC, ch.submitted_at`, T, ...bf.params);
  const openFindings = sql.all(`SELECT f.*, p.first_name, p.last_name, p.avatar_hue FROM findings f JOIN patients p ON p.id = f.patient_id JOIN checkins ch ON ch.id = f.checkin_id
    WHERE f.tenant_id = ? AND f.status IN ('open','confirmed') AND ch.status = 'awaiting_review' ${bf.clause}`, T, ...bf.params);
  const triage = sql.all(`SELECT i.*, p.first_name, p.last_name, p.avatar_hue FROM issue_reports i JOIN patients p ON p.id = i.patient_id
    WHERE i.tenant_id = ? AND i.triage_status != 'resolved' ${bf.clause} ORDER BY i.urgency, i.created_at`, T, ...bf.params);
  const upcoming = sql.all(`SELECT a.*, p.first_name, p.last_name, p.avatar_hue FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.tenant_id = ? AND a.status = 'booked' AND a.start_at >= ? AND a.start_at < ? ${bf.clause} ORDER BY a.start_at`, T, today(), addDays(today(), 8), ...bf.params);
  const recs = sql.all(`SELECT r.*, p.first_name, p.last_name, p.avatar_hue FROM appointment_recommendations r JOIN patients p ON p.id = r.patient_id
    WHERE r.tenant_id = ? AND r.status = 'proposed' ${bf.clause} ORDER BY r.latest`, T, ...bf.params);

  // Overdue check-ins: active patients whose last submission + interval + grace has passed.
  const active = sql.all(`SELECT p.*, pr.checkin_interval_days, pr.grace_hours,
      (SELECT MAX(submitted_at) FROM checkins c2 WHERE c2.patient_id = p.id) AS last_sub
    FROM patients p LEFT JOIN protocols pr ON pr.id = p.protocol_id WHERE p.tenant_id = ? AND p.status = 'active' ${bf.clause}`, T, ...bf.params);
  const overdue = active.map((p) => {
    const since = (p.last_sub ?? p.created_at) as string;
    const dueAt = new Date(new Date(since).getTime() + ((p.checkin_interval_days ?? 7) * 24 + (p.grace_hours ?? 48)) * 3600_000);
    return { p, dueAt, overdueHours: (Date.now() - dueAt.getTime()) / 3600_000 };
  }).filter((x) => x.overdueHours > 0).sort((a, b) => b.overdueHours - a.overdueHours);

  const who = (r: any) => ({ patientId: r.patient_id ?? r.id, patientName: `${r.first_name} ${r.last_name}`, avatarHue: r.avatar_hue });
  const byCat = (cats: string[]) => {
    const seen = new Set<string>();
    return openFindings.filter((f) => cats.includes(f.clinician_category ?? f.category) && !seen.has(f.checkin_id) && seen.add(f.checkin_id))
      .map((f) => ({ ...who(f), checkinId: f.checkin_id, finding: serializeFinding(f) }));
  };
  const ready = awaiting.filter((a) => j.parse<{ recommendation?: string }>(a.gonogo_json, {}).recommendation === 'go');
  const reviewedToday = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM decisions WHERE tenant_id = ? AND decided_at >= ?", T, today())?.n ?? 0;
  const turnaround = sql.all<{ h: number }>(`SELECT (julianday(reviewed_at) - julianday(submitted_at)) * 24 AS h FROM checkins WHERE tenant_id = ? AND reviewed_at IS NOT NULL AND reviewed_at >= ? ORDER BY h`, T, addDays(today(), -30));
  const median = turnaround.length ? turnaround[Math.floor(turnaround.length / 2)].h : null;
  const aiConfigured = (sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_provider_configs WHERE ((scope = 'tenant' AND tenant_id = ?) OR scope = 'platform') AND enabled = 1", T)?.n ?? 0) > 0;

  return {
    kpis: {
      activePatients: active.length, awaitingReview: awaiting.length, triageOpen: triage.length, urgentOpen: triage.filter((t) => t.urgency === 'P1' || t.urgency === 'P2').length,
      overdue: overdue.length, reviewedToday, medianTurnaroundHours: median, readyForStageChange: ready.length, aiConfigured,
    },
    awaiting: awaiting.slice(0, 8).map((a) => ({ ...who(a), checkinId: a.id, submittedAt: a.submitted_at, priority: a.priority_score, reasons: j.parse(a.priority_reasons_json, []),
      gonogo: j.parse(a.gonogo_json, null), stageNo: a.stage_no })),
    triage: triage.slice(0, 8).map((t) => ({ ...who(t), id: t.id, category: t.category, urgency: t.urgency, slaDueAt: t.sla_due_at, status: t.triage_status, createdAt: t.created_at, details: t.details })),
    overdue: overdue.slice(0, 8).map((o) => ({ patientId: o.p.id, patientName: fullName(o.p), avatarHue: o.p.avatar_hue, lastSubmitted: o.p.last_sub, overdueDays: Math.floor(o.overdueHours / 24) + 1 })),
    trackingIssues: byCat(['tracking_gap']),
    attachmentConcerns: byCat(['attachment_missing', 'attachment_damaged']),
    brokenOrLost: triage.filter((t) => t.category === 'aligner_cracked' || t.category === 'aligner_lost').map((t) => ({ ...who(t), id: t.id, category: t.category, urgency: t.urgency, createdAt: t.created_at })),
    readyForStageChange: ready.map((a) => ({ ...who(a), checkinId: a.id, stageNo: a.stage_no, confidence: j.parse<{ confidence?: string }>(a.gonogo_json, {}).confidence })),
    upcomingVisits: upcoming.map((a) => ({ ...who(a), id: a.id, startAt: a.start_at, durationMin: a.duration_min, type: a.type })),
    recommendations: recs.slice(0, 6).map((r) => ({ ...who(r), id: r.id, kind: r.kind, earliest: r.earliest, latest: r.latest, durationMin: r.duration_min, uncertainty: r.uncertainty, label: j.parse<{ label?: string }>(r.factors_json, {}).label })),
  };
}));

// ── Review queue ─────────────────────────────────────────────────────────────
reviewRouter.get('/review-queue', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const bf = branchFilter(c);
  const filter = String(req.query.filter ?? 'all');
  const rows = sql.all(`SELECT ch.*, p.first_name, p.last_name, p.avatar_hue, p.mode, p.doctor_id FROM checkins ch JOIN patients p ON p.id = ch.patient_id
    WHERE ch.tenant_id = ? AND ch.status = 'awaiting_review' ${bf.clause} ORDER BY ch.priority_score DESC, ch.submitted_at`, c.tenantId, ...bf.params);
  const items = rows.map((r) => {
    const findings = sql.all("SELECT * FROM findings WHERE tenant_id = ? AND checkin_id = ? AND status != 'dismissed'", c.tenantId, r.id).map(serializeFinding);
    const thumbs = sql.all(`SELECT id, view, quality_status FROM images WHERE tenant_id = ? AND owner_type = 'checkin' AND owner_id = ? ORDER BY ${VIEW_ORDER} LIMIT 5`, c.tenantId, r.id);
    return {
      checkinId: r.id, patientId: r.patient_id, patientName: `${r.first_name} ${r.last_name}`, avatarHue: r.avatar_hue, mode: r.mode, stageNo: r.stage_no,
      submittedAt: r.submitted_at, waitingHours: r.submitted_at ? Math.round(hoursSince(r.submitted_at)) : 0, priority: r.priority_score, reasons: j.parse(r.priority_reasons_json, []),
      gonogo: j.parse<any>(r.gonogo_json, null), aiStatus: j.parse(r.ai_status, null), findings, thumbs, painLevel: r.pain_level, fit: r.fit, wear: r.wear_hours_bucket,
      mine: r.doctor_id === c.userId,
    };
  });
  const f = (fn: (i: typeof items[number]) => boolean) => items.filter(fn);
  const filtered = filter === 'urgent' ? f((i) => i.priority >= 60)
    : filter === 'tracking' ? f((i) => i.findings.some((x) => x.category === 'tracking_gap'))
    : filter === 'attachments' ? f((i) => i.findings.some((x) => x.category.startsWith('attachment')))
    : filter === 'ready' ? f((i) => i.gonogo?.recommendation === 'go')
    : filter === 'mine' ? f((i) => i.mine) : items;
  return { items: filtered, counts: { all: items.length, urgent: f((i) => i.priority >= 60).length, tracking: f((i) => i.findings.some((x) => x.category === 'tracking_gap')).length,
    attachments: f((i) => i.findings.some((x) => x.category.startsWith('attachment'))).length, ready: f((i) => i.gonogo?.recommendation === 'go').length, mine: f((i) => i.mine).length } };
}));

// ── Review bundle ────────────────────────────────────────────────────────────
reviewRouter.get('/checkins/:id', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!chk) throw notFound('Check-in');
  const p = assertPatientAccess(c, chk.patient_id) && sql.get('SELECT * FROM patients WHERE id = ?', chk.patient_id)!;
  const planRow = activePlan(c.tenantId, p.id);
  const bundle = planRow ? planBundle(c.tenantId, planRow.id) : null;
  const imgs = sql.all(`SELECT * FROM images WHERE tenant_id = ? AND owner_type = 'checkin' AND owner_id = ? ORDER BY ${VIEW_ORDER}, with_aligner DESC`, c.tenantId, chk.id);
  const prevChk = sql.get("SELECT * FROM checkins WHERE tenant_id = ? AND patient_id = ? AND created_at < ? AND submitted_at IS NOT NULL ORDER BY created_at DESC LIMIT 1", c.tenantId, p.id, chk.created_at);
  const prevImgs = VIEWS.map((v) => sql.get(`SELECT i.* FROM images i JOIN checkins x ON x.id = i.owner_id WHERE i.tenant_id = ? AND i.patient_id = ? AND i.owner_type = 'checkin' AND i.view = ?
    AND x.created_at < ? AND i.quality_status IN ('usable','limited') ORDER BY x.created_at DESC LIMIT 1`, c.tenantId, p.id, v, chk.created_at)).filter(Boolean);
  const refs = sql.all(`SELECT * FROM images WHERE tenant_id = ? AND patient_id = ? AND owner_type = 'reference' ORDER BY ${VIEW_ORDER}`, c.tenantId, p.id);
  const annotations = sql.all(`SELECT a.*, u.name AS author FROM annotations a LEFT JOIN users u ON u.id = a.author_id WHERE a.tenant_id = ? AND a.image_id IN (${[...imgs, ...prevImgs, ...refs].map(() => '?').join(',') || "''"})`,
    c.tenantId, ...[...imgs, ...prevImgs, ...refs].map((i: any) => i.id));
  const findings = sql.all('SELECT * FROM findings WHERE tenant_id = ? AND checkin_id = ? ORDER BY CASE status WHEN \'open\' THEN 0 ELSE 1 END, created_at', c.tenantId, chk.id).map(serializeFinding);
  const issues = sql.all("SELECT * FROM issue_reports WHERE tenant_id = ? AND patient_id = ? AND (triage_status != 'resolved' OR created_at >= ?) ORDER BY created_at DESC", c.tenantId, p.id, addDays(today(), -14));
  const rec = sql.get("SELECT * FROM appointment_recommendations WHERE tenant_id = ? AND patient_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1", c.tenantId, p.id);
  const decisions = sql.all('SELECT d.*, u.name AS decided_by_name FROM decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE d.tenant_id = ? AND d.patient_id = ? ORDER BY d.decided_at DESC LIMIT 10', c.tenantId, p.id);
  const wear = sql.all('SELECT date, hours FROM wear_logs WHERE tenant_id = ? AND patient_id = ? AND date >= ? ORDER BY date', c.tenantId, p.id, addDays(today(), -14));
  const proto = protocolOf(c.tenantId, p.id);
  const queue = sql.all("SELECT ch.id FROM checkins ch JOIN patients p2 ON p2.id = ch.patient_id WHERE ch.tenant_id = ? AND ch.status = 'awaiting_review' ORDER BY ch.priority_score DESC, ch.submitted_at", c.tenantId).map((r) => r.id);
  const idx = queue.indexOf(chk.id);
  auditReq(req, 'checkin.view', 'checkin', chk.id, { patientId: p.id });
  return {
    checkin: {
      id: chk.id, status: chk.status, stageNo: chk.stage_no, reportedAligner: chk.reported_aligner, wear: chk.wear_hours_bucket, fit: chk.fit, symptoms: j.parse(chk.symptoms_json, []),
      painLevel: chk.pain_level, concerns: chk.concerns, submittedAt: chk.submitted_at, reviewedAt: chk.reviewed_at, priority: chk.priority_score,
      reasons: j.parse(chk.priority_reasons_json, []), aiStatus: j.parse(chk.ai_status, null),
    },
    gonogo: j.parse(chk.gonogo_json, null),
    patient: patientSummary(c.tenantId, p),
    plan: bundle ? { ...bundle, totalStages: totalStages(bundle), daysOnStage: daysOnStage(bundle) } : null,
    protocol: proto ? { id: proto.id, name: proto.name, requiredViews: proto.required_views, intervalDays: proto.checkin_interval_days, criteria: proto.go_criteria } : null,
    images: imgs.map(serializeImage), previousImages: prevImgs.map(serializeImage), referenceImages: refs.map(serializeImage),
    previousCheckin: prevChk ? { id: prevChk.id, submittedAt: prevChk.submitted_at, stageNo: prevChk.stage_no } : null,
    annotations: annotations.map((a) => ({ id: a.id, imageId: a.image_id, kind: a.kind, geometry: j.parse(a.geometry_json, {}), label: a.label, color: a.color, author: a.author, createdAt: a.created_at })),
    findings,
    issues: issues.map((i) => ({ id: i.id, category: i.category, urgency: i.urgency, status: i.triage_status, details: i.details, painLevel: i.pain_level, createdAt: i.created_at })),
    recommendation: rec ? serializeRec(rec) : null,
    nextCheckin: nextCheckinFor(c.tenantId, p.id),
    decisions: decisions.map((d) => ({ id: d.id, type: d.type, stageFrom: d.stage_from, stageTo: d.stage_to, holdDays: d.hold_days, message: d.message, decidedBy: d.decided_by_name, decidedAt: d.decided_at, overrode: !!d.overrode_recommendation })),
    wear, wearMedian7d: wearMedian(c.tenantId, p.id),
    navigation: { index: idx, total: queue.length, prev: idx > 0 ? queue[idx - 1] : null, next: idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : queue.find((q) => q !== chk.id) ?? null },
  };
}));

export function serializeRec(r: any) {
  const f = j.parse<{ label?: string; factors?: unknown[]; alreadyBooked?: unknown }>(r.factors_json, {});
  return { id: r.id, patientId: r.patient_id, kind: r.kind, label: f.label, earliest: r.earliest, latest: r.latest, targetDate: r.target_date, durationMin: r.duration_min,
    uncertainty: r.uncertainty, factors: f.factors ?? [], alreadyBooked: f.alreadyBooked ?? null, slots: j.parse(r.slot_json, []), engineVersion: r.engine_version, status: r.status,
    finalDate: r.final_date, finalDuration: r.final_duration, createdAt: r.created_at };
}

// ── Decision ─────────────────────────────────────────────────────────────────
const DecisionBody = z.object({
  type: z.enum(['go', 'no_go', 'retake', 'visit']),
  holdDays: z.number().int().min(1).max(30).optional(),
  retakeViews: z.array(z.enum(VIEWS)).optional(),
  message: z.string().max(4000).optional(),
  instructionId: z.string().optional(),
  prescribeChewies: z.boolean().optional(),
  visit: z.object({ date: z.string(), durationMin: z.number().int().min(5).max(240), kind: z.string().optional() }).optional(),
});

reviewRouter.post('/checkins/:id/decision', requireStaff('clinical.decide'), h((req) => {
  const c = staff(req);
  const body = DecisionBody.parse(req.body);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!chk) throw notFound('Check-in');
  assertPatientAccess(c, chk.patient_id);
  if (chk.status === 'reviewed') throw new HttpError(409, 'This check-in has already been reviewed', 'conflict');
  const planRow = activePlan(c.tenantId, chk.patient_id);
  const bundle = planRow ? planBundle(c.tenantId, planRow.id) : null;
  const rec = j.parse<{ recommendation?: string }>(chk.gonogo_json, {});
  const instr = body.instructionId ? sql.get('SELECT * FROM instructions WHERE id = ? AND tenant_id = ?', body.instructionId, c.tenantId) : null;
  if (body.type === 'retake' && !body.retakeViews?.length) throw badRequest('Select at least one view to retake');
  const openFindings = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM findings WHERE tenant_id = ? AND checkin_id = ? AND status = 'open'", c.tenantId, chk.id)?.n ?? 0;

  const decisionId = newId('dec');
  let stageTo: number | null = null;
  const parts: string[] = [];
  sql.tx(() => {
    if (body.type === 'go' && bundle) {
      const total = totalStages(bundle);
      stageTo = Math.min(total, bundle.current_stage + 1);
      if (stageTo > bundle.current_stage) {
        sql.run("UPDATE plan_stages SET status = 'completed', approved_by = ?, approved_at = ? WHERE plan_id = ? AND stage_no = ? AND tenant_id = ?", c.userId, nowIso(), bundle.id, bundle.current_stage, c.tenantId);
        sql.run("UPDATE plan_stages SET status = 'active', actual_start = ? WHERE plan_id = ? AND stage_no = ? AND tenant_id = ?", today(), bundle.id, stageTo, c.tenantId);
        // Re-anchor expected dates of later stages to the actual change date.
        for (const s of bundle.stages.filter((s: any) => s.stage_no >= stageTo!)) {
          const offset = (s.stage_no - stageTo!) * bundle.stage_days;
          sql.run('UPDATE plan_stages SET expected_start = ?, expected_change = ? WHERE id = ? AND tenant_id = ?', addDays(today(), offset), addDays(today(), offset + bundle.stage_days), s.id, c.tenantId);
        }
        sql.update('treatment_plans', bundle.id, c.tenantId, { current_stage: stageTo });
        parts.push(`Great progress! You can switch to aligner ${stageTo} today.`);
      } else parts.push('You have completed your final aligner. Keep wearing it until your end-of-treatment visit.');
    }
    if (body.type === 'no_go') {
      const days = body.holdDays ?? 4;
      parts.push(`Please stay on aligner ${bundle?.current_stage ?? chk.stage_no} for ${days} more day${days === 1 ? '' : 's'} before switching.`);
      if (body.prescribeChewies) parts.push('Use your chewies for 5–10 minutes, 3 times a day, focusing on the areas that are not fully seated.');
      if (bundle) {
        const cur = bundle.stages.find((s: any) => s.stage_no === bundle.current_stage);
        if (cur) sql.run("UPDATE plan_stages SET status = 'held', expected_change = ? WHERE id = ? AND tenant_id = ?", addDays(today(), days), cur.id, c.tenantId);
      }
    }
    if (body.type === 'retake') parts.push(`Please retake these photos: ${body.retakeViews!.join(', ')}.`);
    if (body.type === 'visit') parts.push('Your orthodontist would like to see you in the clinic. The team will contact you to confirm a time.');
    if (instr) parts.push(instr.body);
    if (body.message?.trim()) parts.push(body.message.trim());

    sql.insert('decisions', {
      id: decisionId, tenant_id: c.tenantId, checkin_id: chk.id, patient_id: chk.patient_id, type: body.type, stage_from: bundle?.current_stage ?? chk.stage_no, stage_to: stageTo,
      hold_days: body.type === 'no_go' ? body.holdDays ?? 4 : null, retake_views_json: body.retakeViews ? j.str(body.retakeViews) : null, instruction_id: instr?.id ?? null,
      message: parts.join('\n\n'), decided_by: c.userId, decided_at: nowIso(), recommendation_json: chk.gonogo_json,
      overrode_recommendation: rec.recommendation && rec.recommendation !== body.type && !(rec.recommendation === 'not_yet' && body.type === 'no_go') ? 1 : 0,
    });
    sql.update('checkins', chk.id, c.tenantId, { status: body.type === 'retake' ? 'retake_requested' : 'reviewed', reviewed_at: nowIso(), reviewed_by: c.userId });
    // Open findings the clinician did not explicitly review stay "open" for evaluation honesty (not counted as confirmed).
    systemMessage(c.tenantId, chk.patient_id, parts.join('\n\n'), 'decision', c.userId);

    if (body.type === 'visit') {
      const pat = sql.get('SELECT branch_id, doctor_id FROM patients WHERE id = ?', chk.patient_id)!;
      const proposed = sql.get("SELECT * FROM appointment_recommendations WHERE tenant_id = ? AND patient_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1", c.tenantId, chk.patient_id);
      const date = body.visit?.date ?? proposed?.target_date ?? addDays(today(), 3);
      const dur = body.visit?.durationMin ?? proposed?.duration_min ?? 20;
      if (proposed) sql.update('appointment_recommendations', proposed.id, c.tenantId, {
        status: proposed.target_date === date && proposed.duration_min === dur ? 'accepted' : 'edited', final_date: date, final_duration: dur, decided_by: c.userId, decided_at: nowIso() });
      sql.insert('appointments', { id: newId('apt'), tenant_id: c.tenantId, branch_id: pat.branch_id, patient_id: chk.patient_id, doctor_id: pat.doctor_id, chair: 1,
        start_at: date.length === 10 ? `${date}T09:00` : date, duration_min: dur, type: body.visit?.kind ?? proposed?.kind ?? 'progress_review', status: 'requested',
        recommendation_id: proposed?.id ?? null, notes: 'Requested from review: front desk to confirm time', created_at: nowIso() });
    }
  });
  auditReq(req, `decision.${body.type}`, 'checkin', chk.id, { patientId: chk.patient_id, meta: { decisionId, stageTo, recommendation: rec.recommendation, openFindingsUnreviewed: openFindings } });
  emit(c.tenantId, 'decision.made', { decision_id: decisionId, checkin_id: chk.id, patient_id: chk.patient_id, type: body.type, stage_to: stageTo });
  emit(c.tenantId, 'checkin.reviewed', { checkin_id: chk.id, patient_id: chk.patient_id });
  if (stageTo) emit(c.tenantId, 'stage.advanced', { patient_id: chk.patient_id, stage: stageTo });
  refreshRecommendation(c.tenantId, chk.patient_id, null);
  return { ok: true, decisionId, stageTo, message: parts.join('\n\n') };
}));

// Batch Go: only for check-ins where every go/no-go check passed with high confidence and no open findings.
reviewRouter.post('/review-queue/batch-go', requireStaff('clinical.decide'), h((req) => {
  const c = staff(req);
  const ids = z.object({ checkinIds: z.array(z.string()).min(1).max(50) }).parse(req.body).checkinIds;
  const done: string[] = [], skipped: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const chk = sql.get("SELECT * FROM checkins WHERE id = ? AND tenant_id = ? AND status = 'awaiting_review'", id, c.tenantId);
    const g = j.parse<{ batchEligible?: boolean }>(chk?.gonogo_json, {});
    if (!chk || !g.batchEligible) { skipped.push({ id, reason: 'Not eligible for batch approval' }); continue; }
    done.push(id);
  }
  return { eligible: done, skipped };
}));

// ── Findings review (confirm / dismiss / correct) and clinician-added findings ─
reviewRouter.post('/findings/:id/review', requireStaff('findings.review'), h((req) => {
  const c = staff(req);
  const body = z.object({ action: z.enum(['confirm', 'dismiss', 'correct', 'reopen']), category: z.enum(FINDING_CATEGORIES).optional(), teeth: z.array(z.number().int()).optional(), note: z.string().max(2000).optional() }).parse(req.body);
  const f = sql.get('SELECT * FROM findings WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!f) throw notFound('Finding');
  assertPatientAccess(c, f.patient_id);
  if (body.action === 'correct' && !body.category && !body.teeth) throw badRequest('A correction needs a category or teeth');
  const patch: Record<string, unknown> = {
    status: { confirm: 'confirmed', dismiss: 'dismissed', correct: 'corrected', reopen: 'open' }[body.action], clinician_note: body.note ?? null,
    reviewed_by: body.action === 'reopen' ? null : c.userId, reviewed_at: body.action === 'reopen' ? null : nowIso(),
  };
  if (body.action === 'correct') { if (body.category) patch.clinician_category = body.category; if (body.teeth) patch.region_fdi_json = j.str(body.teeth); }
  sql.update('findings', f.id, c.tenantId, patch);
  auditReq(req, `finding.${body.action}`, 'finding', f.id, { patientId: f.patient_id, meta: { category: f.category, correctedTo: body.category, modelVersion: f.model_version } });
  computeCheckinSignals(c.tenantId, f.checkin_id);
  return serializeFinding(sql.get('SELECT * FROM findings WHERE id = ?', f.id));
}));

reviewRouter.post('/checkins/:id/findings', requireStaff('findings.review'), h((req) => {
  const c = staff(req);
  const body = z.object({ category: z.enum(FINDING_CATEGORIES), teeth: z.array(z.number().int()).default([]), view: z.enum(VIEWS).optional(), imageId: z.string().optional(),
    note: z.string().max(2000).optional(), bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional() }).parse(req.body);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!chk) throw notFound('Check-in');
  assertPatientAccess(c, chk.patient_id);
  const id = newId('fnd');
  sql.insert('findings', { id, tenant_id: c.tenantId, checkin_id: chk.id, patient_id: chk.patient_id, source: 'clinician', category: body.category, region_fdi_json: j.str(body.teeth),
    view: body.view ?? null, image_id: body.imageId ?? null, bbox_json: body.bbox ? j.str(body.bbox) : null, assessment: 'possible', novelty: 'unknown', uncertainty: 'low',
    evidence: body.note ?? 'Added by clinician', status: 'confirmed', clinician_note: body.note ?? null, reviewed_by: c.userId, reviewed_at: nowIso(), created_at: nowIso() });
  auditReq(req, 'finding.add', 'finding', id, { patientId: chk.patient_id, meta: { category: body.category } });
  computeCheckinSignals(c.tenantId, chk.id);
  return serializeFinding(sql.get('SELECT * FROM findings WHERE id = ?', id));
}));

reviewRouter.post('/checkins/:id/reanalyze', requireStaff('findings.review'), h(async (req) => {
  const c = staff(req);
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!chk) throw notFound('Check-in');
  assertPatientAccess(c, chk.patient_id);
  const out = await analyzeCheckin(c.tenantId, chk.id);
  computeCheckinSignals(c.tenantId, chk.id);
  refreshRecommendation(c.tenantId, chk.patient_id, chk.id);
  auditReq(req, 'checkin.reanalyze', 'checkin', chk.id, { patientId: chk.patient_id, meta: out });
  return out;
}));

reviewRouter.post('/checkins/:id/eval-case', requireStaff('findings.review'), h((req) => {
  const c = staff(req);
  const body = z.object({ imageId: z.string(), category: z.enum(FINDING_CATEGORIES), label: z.enum(['present', 'absent', 'cannot_assess']), setName: z.string().default('clinic-labelled'), notes: z.string().optional() }).parse(req.body);
  const img = sql.get('SELECT * FROM images WHERE id = ? AND tenant_id = ?', body.imageId, c.tenantId);
  if (!img) throw notFound('Image');
  const pat = sql.get('SELECT consent_json FROM patients WHERE id = ?', img.patient_id);
  if (!j.parse<Record<string, boolean>>(pat?.consent_json, {}).research) throw new HttpError(409, 'Patient has not consented to research/evaluation use', 'no_consent');
  const id = newId('evc');
  sql.insert('eval_cases', { id, tenant_id: c.tenantId, set_name: body.setName, finding_category: body.category, image_id: img.id, checkin_id: req.params.id, label: body.label, notes: body.notes ?? null, labelled_by: c.userId, created_at: nowIso() });
  auditReq(req, 'evaluation.label', 'image', img.id, { patientId: img.patient_id, meta: { category: body.category, label: body.label } });
  return { id };
}));

// ── Images & annotations ─────────────────────────────────────────────────────
reviewRouter.get('/images/:id', h((req, res) => {
  const ctx = req.ctx;
  if (!ctx || (ctx.kind !== 'staff' && ctx.kind !== 'patient')) throw new HttpError(401, 'Sign in required', 'unauthenticated');
  const img = sql.get('SELECT * FROM images WHERE id = ? AND tenant_id = ?', req.params.id, ctx.tenantId);
  if (!img) throw notFound('Image');
  if (ctx.kind === 'patient' && img.patient_id !== ctx.patientId) throw notFound('Image');
  if (ctx.kind === 'staff') {
    if (!can(ctx.role, 'images.view')) throw new HttpError(403, 'You do not have permission to view images', 'forbidden');
    if (img.owner_type !== 'lead') assertPatientAccess(ctx, img.patient_id);
  }
  const data = getBlob(ctx.tenantId, img.storage_key);
  auditReq(req, 'image.view', 'image', img.id, { patientId: img.owner_type === 'lead' ? null : img.patient_id });
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(data);
}));

reviewRouter.post('/images/:id/annotations', requireStaff('findings.review'), h((req) => {
  const c = staff(req);
  const body = z.object({ kind: z.enum(['pin', 'arrow', 'circle', 'freehand', 'measure', 'rect']), geometry: z.record(z.string(), z.any()), label: z.string().max(200).optional(), color: z.string().max(20).optional() }).parse(req.body);
  const img = sql.get('SELECT * FROM images WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!img) throw notFound('Image');
  assertPatientAccess(c, img.patient_id);
  const id = newId('ann');
  sql.insert('annotations', { id, tenant_id: c.tenantId, image_id: img.id, author_id: c.userId, kind: body.kind, geometry_json: j.str(body.geometry), label: body.label ?? null, color: body.color ?? null, created_at: nowIso() });
  auditReq(req, 'annotation.create', 'image', img.id, { patientId: img.patient_id });
  return { id, imageId: img.id, kind: body.kind, geometry: body.geometry, label: body.label, color: body.color, author: c.name, createdAt: nowIso() };
}));

reviewRouter.delete('/annotations/:id', requireStaff('findings.review'), h((req) => {
  const c = staff(req);
  const a = sql.get('SELECT * FROM annotations WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!a) throw notFound('Annotation');
  sql.run('DELETE FROM annotations WHERE id = ? AND tenant_id = ?', a.id, c.tenantId);
  auditReq(req, 'annotation.delete', 'annotation', a.id);
  return { ok: true };
}));

void daysBetween;
