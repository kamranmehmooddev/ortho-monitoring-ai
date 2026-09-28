import { addDays, daysBetween, weekday } from '../../lib/time.js';
import type { InstructionTag } from './instructionParser.js';

/**
 * Appointment recommendation engine (appt-v1).
 * Answers two questions with visible factors: WHEN should the next in-person visit be, and HOW LONG to reserve.
 * It proposes; staff or doctor accept, edit or dismiss. Urgent reports never auto-book: they go to triage.
 */
export const APPT_ENGINE_VERSION = 'appt-v1';

export interface SchedulingRules {
  durations: { progress_review: number; ipr: number; ipr_per_extra_contact: number; attachment_replacement: number; attachment_per_extra: number;
    tracking_assessment: number; refinement_scan: number; repair: number; repair_per_extra: number; debond: number };
  bufferMin: number; lunch: { start: string; end: string } | null; maxLongPerDay: number; slotStepMin: number; sharedSetupMin: number;
  visitEveryStages: number | null;
}
export const DEFAULT_RULES: SchedulingRules = {
  durations: { progress_review: 20, ipr: 30, ipr_per_extra_contact: 5, attachment_replacement: 20, attachment_per_extra: 10,
    tracking_assessment: 30, refinement_scan: 30, repair: 20, repair_per_extra: 10, debond: 60 },
  bufferMin: 5, lunch: { start: '12:30', end: '13:30' }, maxLongPerDay: 4, slotStepMin: 15, sharedSetupMin: 10, visitEveryStages: null,
};

export type VisitKind = 'progress_review' | 'ipr' | 'attachment_replacement' | 'tracking_assessment' | 'refinement_scan' | 'repair' | 'debond';
export const VISIT_LABELS: Record<VisitKind, string> = {
  progress_review: 'Progress review', ipr: 'IPR visit', attachment_replacement: 'Attachment replacement', tracking_assessment: 'Tracking assessment',
  refinement_scan: 'Refinement scan', repair: 'Appliance repair', debond: 'End of treatment / retention',
};
const KIND_RANK: VisitKind[] = ['repair', 'tracking_assessment', 'ipr', 'attachment_replacement', 'refinement_scan', 'debond', 'progress_review'];

export interface EngineInput {
  today: string;
  currentStage: number; totalStages: number; stageDays: number;
  stageChangeDates: Record<number, string>;       // stage_no → expected change date of that stage (i.e. start of next)
  lastVisitDate: string | null;
  plannedVisits: { stage: number; reason: string; procedures: string[] }[];
  iprPlanned: { teeth: [number, number]; amountMm: number; stage: number }[]; // status planned
  tags: InstructionTag[];
  findings: { category: string; uncertainty: string; novelty: string; teeth: number[]; assessment: string }[];
  patientReportedAttachmentOff: number;            // attachment_off reports still open
  patientReportedRepair: number;                   // bracket/wire reports still open
  poorFitReports: number;
  complianceLowWear: boolean;
  lastQuality: 'usable' | 'limited' | 'unusable' | null;
  alreadyBooked: { date: string; type: string } | null;
  rules: SchedulingRules;
}

export interface Driver { kind: VisitKind; earliest: string; latest: string; minutes: number; factor: string; basis: 'plan' | 'finding' | 'patient_report' | 'instruction' | 'rule'; uncertainty: 'low' | 'medium' | 'high' }
export interface Recommendation {
  version: string; needed: boolean; kind: VisitKind | null; label: string; earliest: string; latest: string; target: string;
  durationMin: number; uncertainty: 'low' | 'medium' | 'high'; factors: { text: string; basis: string; minutes?: number }[]; drivers: Driver[];
  alreadyBooked?: { date: string; type: string } | null;
}

const changeDateOf = (i: EngineInput, stage: number) => i.stageChangeDates[stage] ?? addDays(i.today, Math.max(0, stage - i.currentStage) * i.stageDays);
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);
const round5 = (n: number) => Math.ceil(n / 5) * 5;

export function collectDrivers(i: EngineInput): Driver[] {
  const d = i.rules.durations;
  const drivers: Driver[] = [];
  const horizonStage = i.currentStage + 3;

  // 1. IPR must happen BEFORE the stage that needs the space: window ends at the change date into that stage.
  const iprSoon = i.iprPlanned.filter((x) => x.stage <= horizonStage);
  if (iprSoon.length) {
    const stage = Math.min(...iprSoon.map((x) => x.stage));
    const due = stage <= i.currentStage ? i.today : changeDateOf(i, stage - 1);
    const contacts = iprSoon.filter((x) => x.stage === stage).length;
    drivers.push({ kind: 'ipr', earliest: maxDate(i.today, addDays(due, -7)), latest: maxDate(i.today, due), minutes: d.ipr + Math.max(0, contacts - 2) * d.ipr_per_extra_contact,
      basis: 'plan', uncertainty: 'low',
      factor: `IPR planned before stage ${stage}: ${iprSoon.filter((x) => x.stage === stage).map((x) => `${x.teeth.join('/')} ${x.amountMm} mm`).join(', ')}${stage <= i.currentStage ? ' (overdue: not recorded as done)' : ` (change due ${due})`}` });
  }
  for (const t of i.tags.filter((t): t is Extract<InstructionTag, { type: 'ipr' }> => t.type === 'ipr' && t.stage != null)) {
    if (iprSoon.some((x) => x.stage === t.stage) || t.stage! > horizonStage || t.stage! < i.currentStage) continue;
    const due = changeDateOf(i, t.stage! - 1);
    drivers.push({ kind: 'ipr', earliest: maxDate(i.today, addDays(due, -7)), latest: maxDate(i.today, due), minutes: d.ipr, basis: 'instruction', uncertainty: 'low', factor: `Doctor instruction: "${t.source}"` });
  }

  // 2. Attachments: AI observation (possible) and/or patient report.
  const attach = i.findings.filter((f) => (f.category === 'attachment_missing' || f.category === 'attachment_damaged') && f.assessment === 'possible');
  const attachTeeth = [...new Set(attach.flatMap((f) => f.teeth))];
  const attachCount = Math.max(attachTeeth.length, i.patientReportedAttachmentOff);
  if (attachCount > 0) {
    const persistent = attach.some((f) => f.novelty === 'persistent');
    const selfOnly = attach.length === 0;
    drivers.push({ kind: 'attachment_replacement', earliest: i.today, latest: addDays(i.today, persistent ? 7 : 14),
      minutes: d.attachment_replacement + Math.max(0, attachCount - 1) * d.attachment_per_extra, basis: selfOnly ? 'patient_report' : 'finding',
      uncertainty: selfOnly ? 'medium' : attach.every((f) => f.uncertainty === 'high') ? 'high' : 'medium',
      factor: selfOnly ? `Patient reported ${i.patientReportedAttachmentOff} attachment(s) off`
        : `Attachment possibly missing/damaged at ${attachTeeth.join(', ')}${persistent ? ' in consecutive check-ins' : ''} (needs chairside confirmation)` });
  }
  for (const t of i.tags.filter((t) => t.type === 'check_attachments')) {
    if (drivers.some((x) => x.kind === 'attachment_replacement')) break;
    drivers.push({ kind: 'progress_review', earliest: i.today, latest: addDays(i.today, 28), minutes: d.progress_review, basis: 'instruction', uncertainty: 'low', factor: `Doctor instruction: "${t.source}"` });
  }

  // 3. Tracking: persistent possible gap or repeated poor-fit reports → tracking assessment (+ scan if doctor asked for it).
  const gaps = i.findings.filter((f) => f.category === 'tracking_gap' && f.assessment === 'possible');
  const persistentGap = gaps.some((f) => f.novelty === 'persistent');
  if (persistentGap || i.poorFitReports >= 2) {
    const rescan = i.tags.find((t) => t.type === 'rescan' || t.type === 'refinement');
    drivers.push({ kind: 'tracking_assessment', earliest: i.today, latest: addDays(i.today, 10), minutes: d.tracking_assessment + (rescan ? 15 : 0),
      basis: persistentGap ? 'finding' : 'patient_report', uncertainty: persistentGap ? (gaps.every((g) => g.uncertainty === 'high') ? 'high' : 'medium') : 'medium',
      factor: persistentGap ? `Possible seating gap at ${[...new Set(gaps.flatMap((g) => g.teeth))].join(', ')} seen in consecutive check-ins` : `${i.poorFitReports} poor-fit reports`
        + (rescan ? `; +15 min for scan per instruction "${rescan.source}"` : '') });
  }

  // 4. Fixed-appliance repairs.
  if (i.patientReportedRepair > 0) drivers.push({ kind: 'repair', earliest: i.today, latest: addDays(i.today, 5),
    minutes: d.repair + Math.max(0, i.patientReportedRepair - 1) * d.repair_per_extra, basis: 'patient_report', uncertainty: 'medium',
    factor: `${i.patientReportedRepair} open bracket/wire report(s): triaged separately` });

  // 5. Plan-driven visits: planned visits, "see at stage N", "every N stages", refinement near the end, final stage.
  for (const v of i.plannedVisits.filter((v) => v.stage >= i.currentStage && v.stage <= horizonStage)) {
    if (v.procedures.includes('ipr') && drivers.some((d) => d.kind === 'ipr')) { const d = drivers.find((x) => x.kind === 'ipr')!; d.factor += ` · planned visit: ${v.reason}`; continue; }
    const at = v.stage <= i.currentStage ? i.today : changeDateOf(i, v.stage - 1);
    const kind: VisitKind = v.procedures.includes('ipr') ? 'ipr' : v.procedures.includes('scan') ? 'refinement_scan' : v.procedures.includes('attachments') ? 'attachment_replacement' : 'progress_review';
    drivers.push({ kind, earliest: maxDate(i.today, addDays(at, -4)), latest: maxDate(i.today, addDays(at, 4)), minutes: d[kind] ?? d.progress_review, basis: 'plan', uncertainty: 'low', factor: `Planned visit at stage ${v.stage}: ${v.reason}` });
  }
  for (const t of i.tags) {
    if (t.type === 'see_at_stage' && t.stage >= i.currentStage && t.stage <= horizonStage) {
      const at = changeDateOf(i, t.stage - 1);
      drivers.push({ kind: 'progress_review', earliest: maxDate(i.today, addDays(at, -4)), latest: maxDate(i.today, addDays(at, 4)), minutes: d.progress_review, basis: 'instruction', uncertainty: 'low', factor: `Doctor instruction: "${t.source}"` });
    }
  }
  const every = (i.tags.find((t) => t.type === 'visit_every') as { stages: number } | undefined)?.stages ?? i.rules.visitEveryStages;
  if (every && i.lastVisitDate) {
    const due = addDays(i.lastVisitDate, every * i.stageDays);
    if (daysBetween(i.today, due) <= 21) drivers.push({ kind: 'progress_review', earliest: maxDate(i.today, addDays(due, -5)), latest: maxDate(i.today, addDays(due, 5)), minutes: d.progress_review, basis: 'rule', uncertainty: 'low', factor: `Routine review every ${every} stages (last visit ${i.lastVisitDate})` });
  }
  const end = changeDateOf(i, i.totalStages);
  if (i.currentStage >= i.totalStages - 1 && daysBetween(i.today, end) <= 28) {
    drivers.push({ kind: i.tags.some((t) => t.type === 'refinement' || t.type === 'rescan') ? 'refinement_scan' : 'debond', earliest: maxDate(i.today, addDays(end, -5)), latest: maxDate(i.today, addDays(end, 5)),
      minutes: i.tags.some((t) => t.type === 'refinement' || t.type === 'rescan') ? d.refinement_scan : d.debond, basis: 'plan', uncertainty: 'low', factor: `Final aligner (${i.totalStages}) ends ${end}` });
  }
  // Overdue or same-day windows become "as soon as reasonably possible" (5 days), never a zero-width window.
  for (const d of drivers) if (d.latest < addDays(i.today, 2)) d.latest = addDays(i.today, d.kind === 'repair' ? 3 : 5);
  return drivers;
}

export function recommend(i: EngineInput): Recommendation {
  const drivers = collectDrivers(i);
  if (!drivers.length) {
    return { version: APPT_ENGINE_VERSION, needed: false, kind: null, label: 'No visit needed yet', earliest: i.today, latest: i.today, target: i.today, durationMin: 0,
      uncertainty: 'low', factors: [{ text: 'No planned procedure, instruction, or unresolved concern requires a visit in the next 3 stages', basis: 'rule' }], drivers, alreadyBooked: i.alreadyBooked };
  }
  drivers.sort((a, b) => KIND_RANK.indexOf(a.kind) - KIND_RANK.indexOf(b.kind) || a.latest.localeCompare(b.latest));
  const primary = drivers[0];
  // An existing booking already covers routine reviews; for anything else, suggest converting that booking.
  if (i.alreadyBooked && drivers.every((d) => d.kind === 'progress_review')) {
    return { version: APPT_ENGINE_VERSION, needed: false, kind: null, label: 'Covered by existing booking', earliest: i.today, latest: i.today, target: i.today, durationMin: 0, uncertainty: 'low',
      factors: [{ text: `Routine review already booked for ${i.alreadyBooked.date.replace('T', ' ')}`, basis: 'rule' }, ...drivers.map((d) => ({ text: d.factor, basis: d.basis }))], drivers, alreadyBooked: i.alreadyBooked };
  }
  // Combine drivers whose windows overlap the primary's into one visit (setup time shared).
  const combined = [primary];
  for (const dr of drivers.slice(1)) {
    // Only fold a driver into this visit if it can happen inside the primary's window (urgent visits are never delayed).
    if (dr.earliest <= primary.latest && dr.latest >= primary.earliest) combined.push(dr);
  }
  let earliest = primary.earliest; // folded drivers never delay the primary need
  let latest = combined.map((c) => c.latest).reduce(minDate);
  if (earliest > latest) { earliest = primary.earliest; latest = primary.latest; }
  const distinct = combined.filter((c, idx) => combined.findIndex((x) => x.kind === c.kind) === idx);
  const minutes = round5(distinct.reduce((s, c, idx) => s + (idx === 0 ? c.minutes : Math.max(5, c.minutes - i.rules.sharedSetupMin)), 0));
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const planAnchored = combined.some((c) => c.basis === 'plan' || c.basis === 'instruction');
  let uncertainty = combined.map((c) => c.uncertainty).reduce((a, b) => (rank[a] >= rank[b] ? a : b));
  if (planAnchored && uncertainty === 'high') uncertainty = 'medium';
  const factors: Recommendation['factors'] = combined.map((c) => {
    const di = distinct.indexOf(c);
    return { text: c.factor, basis: c.basis, minutes: di === 0 ? c.minutes : di > 0 ? Math.max(5, c.minutes - i.rules.sharedSetupMin) : undefined };
  });
  if (i.lastQuality === 'limited' || i.lastQuality === 'unusable') factors.push({ text: 'Latest photos were limited quality: in-person confirmation carries more weight', basis: 'rule' });
  if (i.complianceLowWear) factors.push({ text: 'Low reported wear time: consider discussing compliance at the visit', basis: 'rule' });
  if (i.alreadyBooked) factors.push({ text: `Existing ${i.alreadyBooked.type.replace(/_/g, ' ')} on ${i.alreadyBooked.date.replace('T', ' ')}: consider moving it earlier and extending it instead of a second visit`, basis: 'rule' });
  if (uncertainty !== 'low') factors.push({ text: uncertainty === 'high' ? 'Driven by uncertain photo observations: confirm need before booking' : 'Partly based on patient self-report or photo observation', basis: 'rule' });
  const target = combined.some((c) => c.basis === 'plan') ? (earliest > i.today ? earliest : latest) : earliest;
  return { version: APPT_ENGINE_VERSION, needed: true, kind: primary.kind, label: distinct.map((c) => VISIT_LABELS[c.kind]).join(' + '), earliest, latest,
    target: target < i.today ? i.today : target, durationMin: minutes, uncertainty, factors, drivers, alreadyBooked: i.alreadyBooked };
}

// ── Slot finding ──────────────────────────────────────────────────────────────
export interface Availability { doctorId: string; weekday: number; start: string; end: string }
export interface Booked { doctorId: string | null; chair: number; start: string; durationMin: number }
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function findSlots(opts: { from: string; to: string; durationMin: number; doctorId: string; chairs: number; availability: Availability[]; booked: Booked[]; rules: SchedulingRules; limit?: number; notBefore?: string }) {
  const slots: { start: string; doctorId: string; chair: number }[] = [];
  const need = opts.durationMin + opts.rules.bufferMin;
  for (let date = opts.from; date <= opts.to && slots.length < (opts.limit ?? 3); date = addDays(date, 1)) {
    const wd = weekday(date);
    const windows = opts.availability.filter((a) => a.doctorId === opts.doctorId && a.weekday === wd);
    const dayBooked = opts.booked.filter((b) => b.start.startsWith(date));
    const longCount = dayBooked.filter((b) => b.doctorId === opts.doctorId && b.durationMin >= 30).length;
    if (opts.durationMin >= 30 && longCount >= opts.rules.maxLongPerDay) continue;
    for (const w of windows) {
      for (let t = toMin(w.start); t + need <= toMin(w.end); t += opts.rules.slotStepMin) {
        const startIso = `${date}T${fromMin(t)}`;
        if (opts.notBefore && startIso < opts.notBefore) continue;
        if (opts.rules.lunch && t < toMin(opts.rules.lunch.end) && t + opts.durationMin > toMin(opts.rules.lunch.start)) continue;
        const overlaps = (b: Booked) => { const bs = toMin(b.start.slice(11, 16)); return t < bs + b.durationMin + opts.rules.bufferMin && bs < t + need; };
        if (dayBooked.some((b) => b.doctorId === opts.doctorId && overlaps(b))) continue;
        for (let chair = 1; chair <= opts.chairs; chair++) {
          if (!dayBooked.some((b) => b.chair === chair && overlaps(b))) { slots.push({ start: startIso, doctorId: opts.doctorId, chair }); break; }
        }
        if (slots.length && slots[slots.length - 1].start.startsWith(date)) break; // one slot per day keeps suggestions spread
      }
      if (slots.length >= (opts.limit ?? 3)) break;
    }
  }
  return slots;
}
