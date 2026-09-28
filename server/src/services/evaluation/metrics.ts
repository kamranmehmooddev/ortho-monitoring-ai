import { sql } from '../../db/db.js';

/**
 * Operational review statistics per model version and category.
 * These are NOT validated diagnostic accuracy: they describe how clinicians responded to observations in routine review.
 */
export interface CategoryStats {
  modelVersion: string; promptVersion: string; category: string; total: number; reviewed: number; confirmed: number; corrected: number; dismissed: number;
  confirmationRate: number | null; falseAlertRate: number | null; correctionRate: number | null; missed: number;
  byQuality: Record<string, { reviewed: number; dismissed: number }>; byUncertainty: Record<string, { reviewed: number; confirmed: number }>;
}

export function evaluationSummary(tenantId: string | null, sinceIso?: string) {
  const params: unknown[] = [];
  let where = "source = 'model'";
  if (tenantId) { where += ' AND tenant_id = ?'; params.push(tenantId); }
  if (sinceIso) { where += ' AND created_at >= ?'; params.push(sinceIso); }
  const rows = sql.all(`SELECT model_version, prompt_version, category, status, quality_band, uncertainty FROM findings WHERE ${where}`, ...params);
  const map = new Map<string, CategoryStats>();
  for (const r of rows) {
    const key = `${r.model_version}|${r.prompt_version}|${r.category}`;
    let s = map.get(key);
    if (!s) {
      s = { modelVersion: r.model_version ?? 'unknown', promptVersion: r.prompt_version ?? 'unknown', category: r.category, total: 0, reviewed: 0, confirmed: 0, corrected: 0, dismissed: 0,
        confirmationRate: null, falseAlertRate: null, correctionRate: null, missed: 0, byQuality: {}, byUncertainty: {} };
      map.set(key, s);
    }
    s.total++;
    if (r.status !== 'open') {
      s.reviewed++;
      if (r.status === 'confirmed') s.confirmed++;
      if (r.status === 'corrected') s.corrected++;
      if (r.status === 'dismissed') s.dismissed++;
      const q = (s.byQuality[r.quality_band ?? 'unknown'] ??= { reviewed: 0, dismissed: 0 });
      q.reviewed++; if (r.status === 'dismissed') q.dismissed++;
      const u = (s.byUncertainty[r.uncertainty] ??= { reviewed: 0, confirmed: 0 });
      u.reviewed++; if (r.status === 'confirmed') u.confirmed++;
    }
  }
  // Missed findings: clinician-created findings on check-ins where the model ran, attributed to the model that ran.
  const mp: unknown[] = [];
  let mw = "f.source = 'clinician' AND c.ai_status LIKE '%\"status\":\"completed\"%'";
  if (tenantId) { mw += ' AND f.tenant_id = ?'; mp.push(tenantId); }
  if (sinceIso) { mw += ' AND f.created_at >= ?'; mp.push(sinceIso); }
  const missed = sql.all(`SELECT f.category, json_extract(c.ai_status, '$.model') AS model, json_extract(c.ai_status, '$.promptVersion') AS pv FROM findings f JOIN checkins c ON c.id = f.checkin_id WHERE ${mw}`, ...mp);
  for (const m of missed) {
    const key = `${m.model}|${m.pv}|${m.category}`;
    let s = map.get(key);
    if (!s) { s = { modelVersion: m.model ?? 'unknown', promptVersion: m.pv ?? 'unknown', category: m.category, total: 0, reviewed: 0, confirmed: 0, corrected: 0, dismissed: 0, confirmationRate: null, falseAlertRate: null, correctionRate: null, missed: 0, byQuality: {}, byUncertainty: {} }; map.set(key, s); }
    s.missed++;
  }
  const stats = [...map.values()].map((s) => ({
    ...s,
    confirmationRate: s.reviewed ? (s.confirmed + s.corrected) / s.reviewed : null,
    falseAlertRate: s.reviewed ? s.dismissed / s.reviewed : null,
    correctionRate: s.reviewed ? s.corrected / s.reviewed : null,
  })).sort((a, b) => b.total - a.total);
  const tq: unknown[] = tenantId ? [tenantId] : [];
  const runs = sql.all(`SELECT provider, model_version, prompt_version, COUNT(*) AS runs, SUM(CASE WHEN status IN ('ok','fallback') THEN 1 ELSE 0 END) AS ok,
    SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallbacks, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
    AVG(latency_ms) AS avg_latency, SUM(cost_usd) AS cost FROM ai_runs WHERE service = 'observations' ${tenantId ? 'AND tenant_id = ?' : ''} GROUP BY provider, model_version, prompt_version`, ...tq);
  const overrides = sql.get(`SELECT COUNT(*) AS total, SUM(overrode_recommendation) AS overridden FROM decisions ${tenantId ? 'WHERE tenant_id = ?' : ''}`, ...tq);
  const apptEdits = sql.get(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'edited' THEN 1 ELSE 0 END) AS edited, SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
    AVG(CASE WHEN status = 'edited' THEN final_duration - duration_min END) AS avg_duration_delta FROM appointment_recommendations WHERE status != 'proposed' ${tenantId ? 'AND tenant_id = ?' : ''}`, ...tq);
  const cases = sql.all(`SELECT set_name, finding_category, label, COUNT(*) AS n FROM eval_cases ${tenantId ? 'WHERE tenant_id = ?' : ''} GROUP BY set_name, finding_category, label`, ...tq);
  return {
    disclaimer: 'Operational review statistics from routine clinician review. These are not validated diagnostic accuracy and must not be presented as such.',
    validationStatus: 'not_validated', stats, runs, goNoGoOverrides: overrides, appointmentOverrides: apptEdits, labelledCases: cases,
  };
}
