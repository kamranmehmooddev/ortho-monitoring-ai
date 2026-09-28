import { sql, j, VIEW_ORDER } from '../../db/db.js';
import { newId } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { getBlob } from '../storage.js';
import { routeVision } from '../ai/router.js';
import type { VisionImage } from '../ai/types.js';
import { activeAttachments, activePlan, daysOnStage, planBundle, totalStages } from '../plan.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { OBSERVATION_JSON_SCHEMA, ObservationOutput, VIEW_LABELS, type ObservationOutputT, type View } from './schema.js';

export interface FindingDraft {
  category: string; view: string; teeth: number[]; assessment: 'possible' | 'cannot_assess'; uncertainty: 'low' | 'medium' | 'high';
  confidence: number; evidence: string; novelty: 'new' | 'persistent' | 'unknown'; bbox: { x: number; y: number; w: number; h: number } | null;
  needsBetterImage: boolean; patientVisible: boolean; qualityBand: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/**
 * Pure post-processing of validated model output. Enforces the clinical boundary regardless of what the model said:
 * - only `possible` / `cannot_assess` assessments survive; anything else becomes `possible`
 * - IPR can never be anything other than a single `cannot_assess` follow-up
 * - hygiene observations are never patient-visible before review
 * - uncertainty is raised when the underlying image was only "limited" quality
 * - novelty is recomputed against open findings (model's opinion is only a tiebreaker)
 */
export function postProcess(out: ObservationOutputT, ctx: {
  qualityByView: Record<string, string>; activeAttachmentTeeth: number[]; iprScheduled: boolean;
  openFindings: { category: string; teeth: number[]; view: string | null }[];
}): { findings: FindingDraft[]; viewNotes: ObservationOutputT['view_notes']; summary: string } {
  const drafts: FindingDraft[] = [];
  let iprSeen = false;
  const bump = (u: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' => (u === 'low' ? 'medium' : 'high');

  const novelty = (category: string, teeth: number[], view: string, modelSays: string): FindingDraft['novelty'] => {
    const match = ctx.openFindings.some((f) => f.category === category && (f.view === view || !f.view) && (teeth.length === 0 || f.teeth.some((t) => teeth.includes(t))));
    if (match) return 'persistent';
    return modelSays === 'persistent' ? 'unknown' : 'new';
  };

  for (const f of out.findings) {
    const band = ctx.qualityByView[f.view] ?? 'unknown';
    if (band === 'unusable') continue; // never report on an image the quality service rejected
    let assessment: FindingDraft['assessment'] = f.assessment === 'cannot_assess' ? 'cannot_assess' : 'possible';
    let category: string = f.category;
    if (category === 'ipr_followup') {
      if (iprSeen || !ctx.iprScheduled) continue;
      iprSeen = true; assessment = 'cannot_assess';
    }
    if (category === 'attachment_obscured') assessment = 'cannot_assess';
    let uncertainty = f.uncertainty;
    if (band === 'limited') uncertainty = bump(uncertainty);
    if (assessment === 'cannot_assess') uncertainty = 'high';
    const b = f.bbox;
    const bbox = b.w >= 0.98 && b.h >= 0.98 ? null : { x: clamp01(b.x), y: clamp01(b.y), w: clamp01(b.w), h: clamp01(b.h) };
    drafts.push({
      category, view: f.view, teeth: [...new Set(f.teeth_fdi)].sort(), assessment, uncertainty, confidence: clamp01(f.confidence),
      evidence: f.evidence.trim(), novelty: novelty(category, f.teeth_fdi, f.view, f.appears), bbox,
      needsBetterImage: f.needs_better_image || assessment === 'cannot_assess', patientVisible: false, qualityBand: band,
    });
  }

  // Attachment checks → findings (only for attachments that are actually active in the plan).
  const byStatus = new Map<string, { view: string; teeth: number[]; reasons: string[] }>();
  for (const a of out.attachment_checks) {
    if (!ctx.activeAttachmentTeeth.includes(a.tooth_fdi) || a.status === 'present') continue;
    if ((ctx.qualityByView[a.view] ?? 'unknown') === 'unusable') continue;
    if (a.status === 'cannot_assess') {
      const key = `obscured:${a.view}`;
      const g = byStatus.get(key) ?? { view: a.view, teeth: [], reasons: [] };
      g.teeth.push(a.tooth_fdi); if (a.reason) g.reasons.push(a.reason); byStatus.set(key, g);
      continue;
    }
    const category = a.status === 'possibly_missing' ? 'attachment_missing' : 'attachment_damaged';
    if (drafts.some((d) => d.category === category && d.teeth.includes(a.tooth_fdi))) continue;
    const band = ctx.qualityByView[a.view] ?? 'unknown';
    drafts.push({
      category, view: a.view, teeth: [a.tooth_fdi], assessment: 'possible', uncertainty: band === 'limited' ? 'high' : 'medium', confidence: 0.5,
      evidence: a.reason, novelty: novelty(category, [a.tooth_fdi], a.view, 'unclear'), bbox: null, needsBetterImage: band === 'limited', patientVisible: false, qualityBand: band,
    });
  }
  for (const g of byStatus.values()) {
    if (drafts.some((d) => d.category === 'attachment_obscured' && d.view === g.view)) continue;
    drafts.push({
      category: 'attachment_obscured', view: g.view, teeth: [...new Set(g.teeth)].sort(), assessment: 'cannot_assess', uncertainty: 'high', confidence: 0,
      evidence: g.reasons.join('; ') || 'Attachment region not clearly visible', novelty: 'unknown', bbox: null, needsBetterImage: true, patientVisible: false,
      qualityBand: ctx.qualityByView[g.view] ?? 'unknown',
    });
  }
  return { findings: drafts, viewNotes: out.view_notes, summary: out.summary };
}

export type AnalyzeOutcome = { status: 'completed' | 'no_provider' | 'no_consent' | 'no_usable_images' | 'failed' | 'budget'; message: string; findings: number };

/** Runs the observation service for one check-in and stores findings. Safe to call repeatedly (replaces open model findings). */
export async function analyzeCheckin(tenantId: string, checkinId: string): Promise<AnalyzeOutcome> {
  const chk = sql.get('SELECT * FROM checkins WHERE id = ? AND tenant_id = ?', checkinId, tenantId);
  if (!chk) throw new Error('Check-in not found');
  const pat = sql.get('SELECT * FROM patients WHERE id = ? AND tenant_id = ?', chk.patient_id, tenantId)!;
  const consent = j.parse<Record<string, boolean>>(pat.consent_json, {});
  const done = (status: AnalyzeOutcome['status'], message: string, findings = 0): AnalyzeOutcome => {
    sql.update('checkins', checkinId, tenantId, { ai_status: j.str({ status, message, at: nowIso() }) });
    return { status, message, findings };
  };
  if (!consent.ai_processing) return done('no_consent', 'Patient has not consented to AI processing. Images were not sent to any AI provider.');

  const images = sql.all(`SELECT * FROM images WHERE tenant_id = ? AND owner_type = 'checkin' AND owner_id = ? AND quality_status IN ('usable','limited') ORDER BY ${VIEW_ORDER}`, tenantId, checkinId);
  if (!images.length) return done('no_usable_images', 'No image passed the quality check, so no observations were generated.');

  const planRow = activePlan(tenantId, chk.patient_id);
  const bundle = planRow ? planBundle(tenantId, planRow.id) : null;
  const stage = chk.stage_no ?? bundle?.current_stage ?? 1;
  const attachmentsActive = bundle ? activeAttachments(bundle, stage) : [];
  const iprDue = bundle ? bundle.ipr.filter((i: any) => i.status === 'planned' && i.stage_no <= stage + 1) : [];
  const openFindings = sql.all("SELECT category, region_fdi_json, view FROM findings WHERE tenant_id = ? AND patient_id = ? AND checkin_id != ? AND status IN ('open','confirmed','corrected') AND created_at >= datetime('now','-45 days')", tenantId, chk.patient_id, checkinId)
    .map((f) => ({ category: f.category, teeth: j.parse<number[]>(f.region_fdi_json, []), view: f.view }));

  // Assemble labelled images: CURRENT, PREVIOUS (same view, last usable), BASELINE (reference).
  const vision: VisionImage[] = [];
  const labels: string[] = [];
  for (const img of images.slice(0, 6)) {
    const label = `${VIEW_LABELS[img.view as View] ?? img.view}`;
    vision.push({ label: `CURRENT ${label}${img.with_aligner ? ' (aligner in)' : ' (no aligner)'}`, mime: img.mime, data: getBlob(tenantId, img.storage_key) });
    labels.push(`CURRENT ${img.view}`);
    const prev = sql.get(`SELECT i.* FROM images i JOIN checkins c ON c.id = i.owner_id WHERE i.tenant_id = ? AND i.patient_id = ? AND i.owner_type = 'checkin'
      AND i.view = ? AND i.quality_status IN ('usable','limited') AND c.created_at < ? ORDER BY c.created_at DESC LIMIT 1`, tenantId, chk.patient_id, img.view, chk.created_at);
    if (prev) { vision.push({ label: `PREVIOUS ${label}`, mime: prev.mime, data: getBlob(tenantId, prev.storage_key) }); labels.push(`PREVIOUS ${img.view}`); }
    const base = sql.get("SELECT * FROM images WHERE tenant_id = ? AND patient_id = ? AND owner_type = 'reference' AND view = ? ORDER BY created_at LIMIT 1", tenantId, chk.patient_id, img.view);
    if (base && attachmentsActive.length) { vision.push({ label: `BASELINE ${label} (attachments freshly bonded)`, mime: base.mime, data: getBlob(tenantId, base.storage_key) }); labels.push(`BASELINE ${img.view}`); }
  }

  const user = buildUserPrompt({
    mode: pat.mode, stageNo: stage, totalStages: bundle ? totalStages(bundle) : 0, daysOnStage: bundle ? daysOnStage(bundle) : 0,
    plannedStageDays: bundle?.stage_days ?? 0, reportedAligner: chk.reported_aligner, wear: chk.wear_hours_bucket, fit: chk.fit,
    symptoms: j.parse(chk.symptoms_json, []), concerns: chk.concerns,
    attachments: attachmentsActive.map((a: any) => ({ tooth: a.tooth_fdi, type: a.type })),
    iprDue: iprDue.map((i: any) => ({ teeth: `${i.tooth_a}/${i.tooth_b}`, amount: i.amount_mm, stage: i.stage_no })),
    openFindings, viewsProvided: labels,
  });

  const result = await routeVision(tenantId, 'observations', {
    system: SYSTEM_PROMPT, user, images: vision, schema: OBSERVATION_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'orthodontic_observations', maxTokens: 4000, timeoutMs: 90_000,
  }, { promptVersion: PROMPT_VERSION, subjectId: checkinId });

  if (!result.ok) {
    const status = result.reason === 'no_provider' ? 'no_provider' : result.reason === 'budget' ? 'budget' : 'failed';
    return done(status, result.message);
  }
  const parsed = ObservationOutput.safeParse(result.response.json);
  if (!parsed.success) {
    sql.update('ai_runs', result.runId, tenantId, { status: 'error', error: 'Schema validation failed; output discarded' });
    return done('failed', 'The AI response did not match the required format and was discarded.');
  }
  const qualityByView: Record<string, string> = {};
  for (const i of images) {
    const cur = qualityByView[i.view];
    if (!cur || (cur === 'limited' && i.quality_status === 'usable')) qualityByView[i.view] = i.quality_status;
  }
  const processed = postProcess(parsed.data, {
    qualityByView, activeAttachmentTeeth: attachmentsActive.map((a: any) => a.tooth_fdi), iprScheduled: iprDue.length > 0, openFindings,
  });

  sql.tx(() => {
    sql.run("DELETE FROM findings WHERE tenant_id = ? AND checkin_id = ? AND source = 'model' AND status = 'open'", tenantId, checkinId);
    for (const d of processed.findings) {
      const img = images.find((i) => i.view === d.view);
      sql.insert('findings', {
        id: newId('fnd'), tenant_id: tenantId, checkin_id: checkinId, patient_id: chk.patient_id, ai_run_id: result.runId, source: 'model',
        category: d.category, region_fdi_json: j.str(d.teeth), view: d.view, image_id: img?.id ?? null, bbox_json: d.bbox ? j.str(d.bbox) : null,
        assessment: d.assessment, novelty: d.novelty, uncertainty: d.uncertainty, confidence: d.confidence, rationale: processed.summary,
        evidence: d.evidence, needs_better_image: d.needsBetterImage, patient_visible: 0, model_version: result.model, prompt_version: PROMPT_VERSION,
        quality_band: d.qualityBand, status: 'open', created_at: nowIso(),
      });
    }
  });
  sql.update('checkins', checkinId, tenantId, {
    ai_status: j.str({ status: 'completed', message: processed.summary, viewNotes: processed.viewNotes, provider: result.provider, model: result.model, promptVersion: PROMPT_VERSION, at: nowIso(), attempts: result.attempts }),
  });
  return { status: 'completed', message: processed.summary, findings: processed.findings.length };
}
