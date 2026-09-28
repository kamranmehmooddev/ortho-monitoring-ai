import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assessImage } from '../src/services/quality/imageQuality.js';
import { DEFAULT_GO_CRITERIA, evaluateGoNoGo, type GoNoGoInput } from '../src/services/scheduling/gonogo.js';
import { triage } from '../src/services/scheduling/triage.js';
import { parseInstructions, parseTeeth } from '../src/services/scheduling/instructionParser.js';
import { DEFAULT_RULES, findSlots, recommend, type EngineInput } from '../src/services/scheduling/appointmentEngine.js';
import { nextCheckin } from '../src/services/scheduling/nextCheckin.js';
import { postProcess } from '../src/services/observations/observationService.js';
import { ObservationOutput } from '../src/services/observations/schema.js';
import { addDays, today } from '../src/lib/time.js';

const asset = (n: string) => fs.readFileSync(path.join(__dirname, '..', 'seed-assets', `${n}.jpg`));

describe('image quality service (deterministic)', () => {
  it('accepts well-lit, sharp, framed images', () => {
    expect(assessImage(asset('front_aligner_a'), undefined, 'front').status).toBe('usable');
    expect(assessImage(asset('upper_noaligner_a'), undefined, 'upper').status).toBe('usable');
  });
  it('rejects dark images with a specific retake tip', () => {
    const r = assessImage(asset('front_dark_a'), undefined, 'front');
    expect(r.status).toBe('unusable');
    expect(r.checks.find((c) => c.id === 'exposure')?.passed).toBe(false);
    expect(r.retakeTip).toMatch(/window|light/i);
  });
  it('rejects blurry images', () => {
    const r = assessImage(asset('left_blurry_a'), undefined, 'left');
    expect(r.status).toBe('unusable');
    expect(r.checks.find((c) => c.id === 'sharpness')?.passed).toBe(false);
  });
  it('marks glare as limited (soft fail) rather than unusable', () => {
    const r = assessImage(asset('upper_glare_a'), undefined, 'upper');
    expect(r.status).toBe('limited');
    expect(r.checks.find((c) => c.id === 'clipping')?.passed).toBe(false);
  });
  it('is reproducible', () => {
    expect(assessImage(asset('front_gap_a')).metrics).toEqual(assessImage(asset('front_gap_a')).metrics);
  });
});

const baseGo: GoNoGoInput = {
  criteria: DEFAULT_GO_CRITERIA, daysOnStage: 14, plannedStageDays: 14, currentStage: 8, totalStages: 24,
  requiredViews: ['front', 'left', 'right', 'upper', 'lower'], viewQuality: { front: 'usable', left: 'usable', right: 'usable', upper: 'usable', lower: 'usable' },
  wearHours: 22, fit: 'good', findings: [], urgentOpenIssues: 0, iprBeforeNextStage: [], aiStatus: 'completed',
};

describe('go/no-go engine', () => {
  it('recommends Go with high confidence when every check passes', () => {
    const r = evaluateGoNoGo(baseGo);
    expect(r.recommendation).toBe('go');
    expect(r.confidence).toBe('high');
    expect(r.batchEligible).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });
  it('asks for a retake when a required view is unusable', () => {
    expect(evaluateGoNoGo({ ...baseGo, viewQuality: { ...baseGo.viewQuality, front: 'unusable' } }).recommendation).toBe('retake');
  });
  it('never allows batch approval when AI observations are unavailable', () => {
    const r = evaluateGoNoGo({ ...baseGo, aiStatus: 'no_provider' });
    expect(r.recommendation).toBe('go');
    expect(r.confidence).toBe('low');
    expect(r.batchEligible).toBe(false);
  });
  it('holds on a possible seating gap and suggests a visit when persistent', () => {
    const gap = { category: 'tracking_gap', assessment: 'possible', uncertainty: 'medium', novelty: 'new', teeth: [11, 21], status: 'open' };
    expect(evaluateGoNoGo({ ...baseGo, findings: [gap] }).recommendation).toBe('no_go');
    expect(evaluateGoNoGo({ ...baseGo, findings: [{ ...gap, novelty: 'persistent' }] }).recommendation).toBe('visit');
  });
  it('ignores high-uncertainty gaps for the decision but lowers confidence', () => {
    const r = evaluateGoNoGo({ ...baseGo, findings: [{ category: 'tracking_gap', assessment: 'possible', uncertainty: 'high', novelty: 'new', teeth: [11], status: 'open' }] });
    expect(r.recommendation).toBe('go');
    expect(r.confidence).toBe('low');
  });
  it('requires a visit when IPR is due before the next stage (never assumes IPR from photos)', () => {
    const r = evaluateGoNoGo({ ...baseGo, iprBeforeNextStage: [{ teeth: '12/13', amount: 0.3, stage: 9 }] });
    expect(r.recommendation).toBe('visit');
    expect(r.checks.find((c) => c.id === 'ipr')?.detail).toMatch(/cannot confirm/);
  });
  it('holds pending triage for urgent reports, and says not-yet when too early', () => {
    expect(evaluateGoNoGo({ ...baseGo, urgentOpenIssues: 1 }).recommendation).toBe('no_go');
    const early = evaluateGoNoGo({ ...baseGo, daysOnStage: 9 });
    expect(early.recommendation).toBe('not_yet');
    expect(early.suggestedHoldDays).toBe(4);
  });
  it('holds for low wear', () => {
    expect(evaluateGoNoGo({ ...baseGo, wearHours: 16 }).recommendation).toBe('no_go');
  });
});

describe('triage', () => {
  it('escalates red-flag language to P1 regardless of category', () => {
    expect(triage({ category: 'other', details: 'I think I swallowed part of the wire' }).urgency).toBe('P1');
    expect(triage({ category: 'pain', painLevel: 9 }).urgency).toBe('P1');
  });
  it('classifies common reports', () => {
    expect(triage({ category: 'aligner_lost' }).urgency).toBe('P2');
    expect(triage({ category: 'attachment_off' }).urgency).toBe('P3');
    expect(triage({ category: 'attachment_off', attachmentsOffCount: 3 }).urgency).toBe('P2');
    expect(triage({ category: 'bracket_loose' }).urgency).toBe('P2');
    expect(triage({ category: 'other' }).urgency).toBe('P4');
  });
  it('always returns interim guidance and an SLA', () => {
    const t = triage({ category: 'aligner_lost' });
    expect(t.guidance).toMatch(/previous aligner/);
    expect(t.slaMinutes).toBe(240);
  });
});

describe('instruction parser', () => {
  it('parses FDI and Palmer notation', () => {
    expect(parseTeeth('check UR3 and UL3')).toEqual([13, 23]);
    expect(parseTeeth('IPR 12/13')).toEqual([12, 13]);
  });
  it('extracts IPR, rescan, cadence and extra time', () => {
    const tags = parseInstructions('IPR 0.3mm 12/13 at stage 10. Rescan if tracking poor. Review every 6 stages. Allow extra 10 min.');
    expect(tags.find((t) => t.type === 'ipr')).toMatchObject({ teeth: [12, 13], amountMm: 0.3, stage: 10 });
    expect(tags.find((t) => t.type === 'rescan')).toMatchObject({ condition: 'tracking poor' });
    expect(tags.find((t) => t.type === 'visit_every')).toMatchObject({ stages: 6 });
    expect(tags.find((t) => t.type === 'extra_time')).toMatchObject({ minutes: 10 });
  });
});

const T0 = today();
const baseEngine: EngineInput = {
  today: T0, currentStage: 8, totalStages: 24, stageDays: 14,
  stageChangeDates: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i + 1, addDays(T0, (i + 1 - 8) * 14 + 7)])),
  lastVisitDate: addDays(T0, -20), plannedVisits: [], iprPlanned: [], tags: [], findings: [], patientReportedAttachmentOff: 0, patientReportedRepair: 0,
  poorFitReports: 0, complianceLowWear: false, lastQuality: 'usable', alreadyBooked: null, rules: DEFAULT_RULES,
};

describe('appointment engine: when and how long', () => {
  it('needs no visit when nothing drives one', () => {
    expect(recommend(baseEngine).needed).toBe(false);
  });
  it('schedules IPR before the stage that needs the space, with chair time per contact', () => {
    const r = recommend({ ...baseEngine, iprPlanned: [{ teeth: [12, 13], amountMm: 0.3, stage: 10 }, { teeth: [22, 23], amountMm: 0.3, stage: 10 }, { teeth: [32, 33], amountMm: 0.2, stage: 10 }] });
    expect(r.kind).toBe('ipr');
    expect(r.latest).toBe(baseEngine.stageChangeDates[9]); // must happen before aligner 10 starts
    expect(r.durationMin).toBe(35); // 30 base + 5 for the third contact
    expect(r.uncertainty).toBe('low');
  });
  it('distinguishes attachment replacement from tracking assessment in duration and uncertainty', () => {
    const att = recommend({ ...baseEngine, findings: [{ category: 'attachment_missing', assessment: 'possible', uncertainty: 'medium', novelty: 'new', teeth: [13, 23] }] });
    expect(att.kind).toBe('attachment_replacement');
    expect(att.durationMin).toBe(30);
    const trk = recommend({ ...baseEngine, findings: [{ category: 'tracking_gap', assessment: 'possible', uncertainty: 'high', novelty: 'persistent', teeth: [11] }], tags: [{ type: 'rescan', condition: 'tracking poor', stage: null, source: 'Rescan if tracking poor' }] });
    expect(trk.kind).toBe('tracking_assessment');
    expect(trk.durationMin).toBe(45);
    expect(trk.uncertainty).toBe('high');
  });
  it('combines concurrent needs into one visit with shared setup time', () => {
    const r = recommend({ ...baseEngine, iprPlanned: [{ teeth: [12, 13], amountMm: 0.3, stage: 9 }], findings: [{ category: 'attachment_missing', assessment: 'possible', uncertainty: 'medium', novelty: 'new', teeth: [23] }] });
    expect(r.label).toContain('+');
    expect(r.durationMin).toBe(40); // 30 IPR + (20 − 10 shared setup)
  });
  it('never delays an urgent repair to match a later planned visit', () => {
    const r = recommend({ ...baseEngine, patientReportedRepair: 1, plannedVisits: [{ stage: 9, reason: 'Archwire change', procedures: [] }] });
    expect(r.kind).toBe('repair');
    expect(r.earliest).toBe(T0);
  });
  it('a booked routine visit covers routine reviews', () => {
    const r = recommend({ ...baseEngine, tags: [{ type: 'see_at_stage', stage: 9, source: 'See at stage 9' }], alreadyBooked: { date: `${addDays(T0, 8)}T09:00`, type: 'progress_review' } });
    expect(r.needed).toBe(false);
  });
});

describe('slot finder', () => {
  it('respects availability, lunch, buffers and existing bookings', () => {
    let monday = T0; while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
    const slots = findSlots({ from: monday, to: monday, durationMin: 30, doctorId: 'd1', chairs: 1, rules: DEFAULT_RULES,
      availability: [{ doctorId: 'd1', weekday: 1, start: '09:00', end: '10:30' }], booked: [{ doctorId: 'd1', chair: 1, start: `${monday}T09:00`, durationMin: 30 }] });
    expect(slots[0].start).toBe(`${monday}T09:45`);
  });
});

describe('next check-in', () => {
  it('shortens after a hold and after a retake, and never lands after the next change date', () => {
    const base = { lastCheckin: T0, intervalDays: 14, nextChangeDate: null, lastDecision: null, holdDays: 0, consecutiveCleanGo: 0, lowWearStreak: 0 } as const;
    expect(nextCheckin({ ...base, lastDecision: 'retake' }).date).toBe(addDays(T0, 2));
    expect(nextCheckin({ ...base, lastDecision: 'no_go', holdDays: 4 }).date).toBe(addDays(T0, 4));
    expect(nextCheckin({ ...base, nextChangeDate: addDays(T0, 10) }).date).toBe(addDays(T0, 9));
    expect(nextCheckin({ ...base, consecutiveCleanGo: 3 }).date).toBe(addDays(T0, 21));
  });
});

describe('observation post-processing enforces the clinical boundary', () => {
  const raw = {
    summary: 'Aligners visible on all views.',
    view_notes: [{ view: 'front', usable_for_assessment: true, limitation: '' }],
    findings: [
      { category: 'tracking_gap', view: 'front', teeth_fdi: [11, 21], assessment: 'confirmed', uncertainty: 'low', confidence: 0.9, evidence: 'gap', compared_with: 'previous', appears: 'new', bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, needs_better_image: false },
      { category: 'ipr_followup', view: 'front', teeth_fdi: [12, 13], assessment: 'possible', uncertainty: 'low', confidence: 0.8, evidence: 'IPR looks done', compared_with: 'none', appears: 'unclear', bbox: { x: 0, y: 0, w: 1, h: 1 }, needs_better_image: false },
      { category: 'plaque', view: 'lower', teeth_fdi: [31], assessment: 'possible', uncertainty: 'low', confidence: 0.7, evidence: 'plaque', compared_with: 'none', appears: 'new', bbox: { x: 0, y: 0, w: 1, h: 1 }, needs_better_image: false },
      { category: 'tracking_gap', view: 'left', teeth_fdi: [23], assessment: 'possible', uncertainty: 'low', confidence: 0.6, evidence: 'gap', compared_with: 'previous', appears: 'new', bbox: { x: 0, y: 0, w: 1, h: 1 }, needs_better_image: false },
    ],
    attachment_checks: [
      { tooth_fdi: 13, view: 'upper', status: 'possibly_missing', reason: 'surface clear, no bump' },
      { tooth_fdi: 14, view: 'upper', status: 'cannot_assess', reason: 'glare' },
      { tooth_fdi: 47, view: 'lower', status: 'possibly_missing', reason: 'not in plan' },
    ],
  };
  const out = postProcess(ObservationOutput.parse(raw), {
    qualityByView: { front: 'usable', left: 'unusable', upper: 'limited', lower: 'usable' }, activeAttachmentTeeth: [13, 14], iprScheduled: true,
    openFindings: [{ category: 'tracking_gap', teeth: [21], view: 'front' }],
  });
  it('never emits a "confirmed" assessment', () => {
    expect(out.findings.every((f) => f.assessment === 'possible' || f.assessment === 'cannot_assess')).toBe(true);
  });
  it('forces IPR to cannot_assess', () => {
    expect(out.findings.find((f) => f.category === 'ipr_followup')).toMatchObject({ assessment: 'cannot_assess', uncertainty: 'high' });
  });
  it('drops findings on images the quality service rejected', () => {
    expect(out.findings.some((f) => f.view === 'left')).toBe(false);
  });
  it('recomputes novelty against open findings', () => {
    expect(out.findings.find((f) => f.category === 'tracking_gap')?.novelty).toBe('persistent');
  });
  it('separates "possibly missing" from "cannot assess" and ignores teeth without planned attachments', () => {
    expect(out.findings.find((f) => f.category === 'attachment_missing')).toMatchObject({ teeth: [13], uncertainty: 'high' }); // limited image → uncertainty raised
    expect(out.findings.find((f) => f.category === 'attachment_obscured')).toMatchObject({ teeth: [14], assessment: 'cannot_assess' });
    expect(out.findings.some((f) => f.teeth.includes(47))).toBe(false);
  });
  it('keeps every finding hidden from the patient until reviewed', () => {
    expect(out.findings.every((f) => !f.patientVisible)).toBe(true);
  });
});
