import { sql, j } from '../db/db.js';
import { addDays, daysBetween, today } from '../lib/time.js';

export function activePlan(tenantId: string, patientId: string) {
  return sql.get("SELECT * FROM treatment_plans WHERE tenant_id = ? AND patient_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1", tenantId, patientId);
}

export function planBundle(tenantId: string, planId: string) {
  const plan = sql.get('SELECT * FROM treatment_plans WHERE id = ? AND tenant_id = ?', planId, tenantId);
  if (!plan) return null;
  return {
    ...plan,
    instruction_tags: j.parse(plan.instruction_tags_json, []),
    stages: sql.all('SELECT * FROM plan_stages WHERE plan_id = ? AND tenant_id = ? ORDER BY stage_no', planId, tenantId),
    attachments: sql.all('SELECT * FROM attachments WHERE plan_id = ? AND tenant_id = ? ORDER BY tooth_fdi', planId, tenantId),
    ipr: sql.all('SELECT * FROM ipr_events WHERE plan_id = ? AND tenant_id = ? ORDER BY stage_no, tooth_a', planId, tenantId),
    visits: sql.all('SELECT * FROM planned_visits WHERE plan_id = ? AND tenant_id = ? ORDER BY stage_no', planId, tenantId).map((v) => ({ ...v, procedures: j.parse(v.procedures_json, []) })),
  };
}
export type PlanBundle = NonNullable<ReturnType<typeof planBundle>>;

export const totalStages = (p: { total_upper: number; total_lower: number }) => Math.max(p.total_upper, p.total_lower);

export function stageRow(bundle: PlanBundle, stageNo: number) {
  return bundle.stages.find((s: any) => s.stage_no === stageNo);
}

export function daysOnStage(bundle: PlanBundle, on = today()) {
  const s = stageRow(bundle, bundle.current_stage);
  const start = s?.actual_start ?? s?.expected_start ?? bundle.start_date;
  return Math.max(0, daysBetween(start, on));
}

export const activeAttachments = (bundle: PlanBundle, stage: number) =>
  bundle.attachments.filter((a: any) => a.placed_stage <= stage && (a.removed_stage == null || a.removed_stage > stage));

/** Generates the stage schedule from start date + stage duration. */
export function generateStages(startDate: string, total: number, stageDays: number) {
  return Array.from({ length: total }, (_, i) => ({
    stage_no: i + 1,
    expected_start: addDays(startDate, i * stageDays),
    expected_change: addDays(startDate, (i + 1) * stageDays),
  }));
}

/** Which buccal views show a given FDI tooth (for attachment checks). */
export function viewsForTooth(fdi: number): string[] {
  const q = Math.floor(fdi / 10), n = fdi % 10;
  const views: string[] = [];
  if (n <= 3) views.push('front');
  if (q === 1 || q === 4) views.push('right'); else views.push('left');
  views.push(q <= 2 ? 'upper' : 'lower');
  return views;
}
