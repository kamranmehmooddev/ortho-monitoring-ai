/**
 * Go/No-go engine (gonogo-v1). Deterministic and explainable; produces a RECOMMENDATION only.
 * The patient's stage changes exclusively through a clinician decision.
 */
export const GONOGO_VERSION = 'gonogo-v1';

export type GoNoGo = 'go' | 'no_go' | 'retake' | 'visit' | 'not_yet';
export interface GoCriteria { toleranceDays: number; minWearHours: number; requireAllViews: boolean }
export const DEFAULT_GO_CRITERIA: GoCriteria = { toleranceDays: 1, minWearHours: 20, requireAllViews: true };

export interface GoFinding { category: string; assessment: string; uncertainty: string; novelty: string; teeth: number[]; status: string }
export interface GoNoGoInput {
  criteria: GoCriteria;
  daysOnStage: number; plannedStageDays: number; currentStage: number; totalStages: number;
  requiredViews: string[]; viewQuality: Record<string, string | undefined>;
  wearHours: number | null; fit: string | null;
  findings: GoFinding[];
  urgentOpenIssues: number;
  iprBeforeNextStage: { teeth: string; amount: number; stage: number }[];
  aiStatus: string | null;
}
export interface GoCheck { id: string; label: string; passed: boolean; detail: string; effect?: GoNoGo | 'lower_confidence' }
export interface GoNoGoResult { version: string; recommendation: GoNoGo; confidence: 'high' | 'medium' | 'low'; headline: string; checks: GoCheck[]; suggestedHoldDays: number; batchEligible: boolean }

const WEAR_BUCKET_HOURS: Record<string, number> = { '<16': 14, '16-20': 18, '20-22': 21, '22+': 22.5 };
export const wearFromBucket = (b: string | null | undefined) => (b ? WEAR_BUCKET_HOURS[b] ?? null : null);

export function evaluateGoNoGo(i: GoNoGoInput): GoNoGoResult {
  const c = i.criteria;
  const checks: GoCheck[] = [];
  const open = i.findings.filter((f) => f.status === 'open' || f.status === 'confirmed' || f.status === 'corrected');
  const gaps = open.filter((f) => f.category === 'tracking_gap' && f.assessment === 'possible' && f.uncertainty !== 'high');
  const persistentGaps = gaps.filter((f) => f.novelty === 'persistent');
  const attach = open.filter((f) => f.category === 'attachment_missing' || f.category === 'attachment_damaged');
  const damage = open.filter((f) => f.category === 'aligner_damage');
  const teeth = (fs: GoFinding[]) => [...new Set(fs.flatMap((f) => f.teeth))].sort((a, b) => a - b).join(', ');

  const missingViews = i.requiredViews.filter((v) => !i.viewQuality[v] || i.viewQuality[v] === 'unusable');
  const limitedViews = i.requiredViews.filter((v) => i.viewQuality[v] === 'limited');
  checks.push({ id: 'views', label: 'Required photos usable', passed: missingViews.length === 0,
    detail: missingViews.length ? `Unusable or missing: ${missingViews.join(', ')}` : limitedViews.length ? `All present; limited quality: ${limitedViews.join(', ')}` : 'All required views passed quality checks',
    effect: missingViews.length && c.requireAllViews ? 'retake' : undefined });

  checks.push({ id: 'triage', label: 'No urgent report pending', passed: i.urgentOpenIssues === 0,
    detail: i.urgentOpenIssues ? `${i.urgentOpenIssues} P1/P2 report awaiting triage` : 'No open P1/P2 reports', effect: i.urgentOpenIssues ? 'no_go' : undefined });

  checks.push({ id: 'ipr', label: 'IPR due before next aligner', passed: i.iprBeforeNextStage.length === 0,
    detail: i.iprBeforeNextStage.length ? `Planned IPR not recorded as done: ${i.iprBeforeNextStage.map((x) => `${x.teeth} ${x.amount} mm (stage ${x.stage})`).join('; ')}. A photo cannot confirm IPR.` : 'No IPR required before the next stage',
    effect: i.iprBeforeNextStage.length ? 'visit' : undefined });

  checks.push({ id: 'tracking', label: 'No possible seating gap', passed: gaps.length === 0,
    detail: persistentGaps.length ? `Persistent possible gap at ${teeth(persistentGaps)} across check-ins` : gaps.length ? `Possible gap at ${teeth(gaps)}` : i.aiStatus === 'completed' ? 'No gap observed in usable images' : 'Not assessed by AI; review images',
    effect: persistentGaps.length ? 'visit' : gaps.length ? 'no_go' : undefined });

  checks.push({ id: 'damage', label: 'Aligner intact', passed: damage.length === 0,
    detail: damage.length ? 'Possible aligner damage observed' : 'No damage observed or reported', effect: damage.length ? 'no_go' : undefined });

  const fitOk = i.fit == null || i.fit === 'good';
  checks.push({ id: 'fit', label: 'Patient reports good fit', passed: fitOk, detail: i.fit ? `Patient reported fit: ${i.fit}` : 'Fit not reported', effect: fitOk ? undefined : 'no_go' });

  const wearOk = i.wearHours == null || i.wearHours >= c.minWearHours;
  checks.push({ id: 'wear', label: `Wear ≥ ${c.minWearHours} h/day`, passed: wearOk,
    detail: i.wearHours == null ? 'Wear time not reported' : `Reported ≈ ${i.wearHours} h/day`, effect: wearOk ? undefined : 'no_go' });

  const minDays = i.plannedStageDays - c.toleranceDays;
  const timeOk = i.daysOnStage >= minDays;
  checks.push({ id: 'time', label: 'Planned wear period complete', passed: timeOk,
    detail: `${i.daysOnStage} of ${i.plannedStageDays} days on aligner ${i.currentStage}`, effect: timeOk ? undefined : 'not_yet' });

  checks.push({ id: 'attachments', label: 'Attachments present', passed: attach.length === 0,
    detail: attach.length ? `Attachment possibly missing/damaged at ${teeth(attach)}: replacement visit suggested` : 'No attachment concern observed', effect: attach.length ? 'lower_confidence' : undefined });

  let recommendation: GoNoGo = 'go';
  const effects = checks.map((x) => x.effect).filter(Boolean) as string[];
  if (effects.includes('retake')) recommendation = 'retake';
  else if (i.urgentOpenIssues) recommendation = 'no_go';
  else if (effects.includes('visit')) recommendation = 'visit';
  else if (effects.includes('no_go')) recommendation = 'no_go';
  else if (effects.includes('not_yet')) recommendation = 'not_yet';

  let confidence: GoNoGoResult['confidence'] = 'high';
  if (limitedViews.length || i.aiStatus !== 'completed' || open.some((f) => f.uncertainty === 'high')) confidence = 'low';
  else if (attach.length || i.wearHours == null || i.fit == null) confidence = 'medium';

  const suggestedHoldDays = recommendation === 'no_go' ? (gaps.length || !fitOk ? 4 : !wearOk ? 5 : 3) : recommendation === 'not_yet' ? Math.max(1, minDays - i.daysOnStage) : 0;
  const final = i.currentStage >= i.totalStages;
  const headline = {
    go: final ? 'Final aligner complete: schedule end-of-series review' : `Ready for aligner ${i.currentStage + 1}`,
    no_go: `Stay on aligner ${i.currentStage}${suggestedHoldDays ? ` for ~${suggestedHoldDays} more days` : ''}`,
    retake: 'New photos needed before a decision',
    visit: 'In-person visit needed before advancing',
    not_yet: `Too early: ${suggestedHoldDays} day(s) left on aligner ${i.currentStage}`,
  }[recommendation];
  const batchEligible = recommendation === 'go' && confidence === 'high' && open.length === 0;
  return { version: GONOGO_VERSION, recommendation, confidence, headline, checks, suggestedHoldDays, batchEligible };
}
