import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-ai-'));
process.env.OMA_DATA_DIR = dir;
process.env.OMA_DB_FILE = path.join(dir, 'ai.sqlite');

const { openDb, sql, j } = await import('../src/db/db.js');
const crypto = await import('../src/security/crypto.js');
const { newId } = await import('../src/lib/ids.js');
const { nowIso, today, addDays } = await import('../src/lib/time.js');
const { registerAdapter } = await import('../src/services/ai/router.js');
const { ProviderError } = await import('../src/services/ai/types.js');
const { analyzeCheckin } = await import('../src/services/observations/observationService.js');
const { storeImage } = await import('../src/services/images.js');
const { tenantKey } = await import('../src/services/storage.js');
const { seedTenantDefaults } = await import('../src/db/defaults.js');
const { generateStages } = await import('../src/services/plan.js');

const seen: { provider: string; key: string; images: number }[] = [];
const modelOutput = {
  summary: 'Aligners visible.', view_notes: [{ view: 'front', usable_for_assessment: true, limitation: '' }],
  findings: [{ category: 'tracking_gap', view: 'front', teeth_fdi: [11, 21], assessment: 'definite', uncertainty: 'low', confidence: 0.8, evidence: 'Visible space at incisal edges', compared_with: 'previous', appears: 'new', bbox: { x: 0.4, y: 0.45, w: 0.2, h: 0.1 }, needs_better_image: false }],
  attachment_checks: [{ tooth_fdi: 13, view: 'front', status: 'cannot_assess', reason: 'reflection' }],
};
registerAdapter({ id: 'openai', label: 'fake-failing', defaultModel: 'x', models: [], endpointConfigurable: false, pricing: () => ({ input: 1, output: 1 }),
  async analyze(cfg) { seen.push({ provider: 'openai', key: cfg.apiKey, images: 0 }); throw new ProviderError('HTTP 503', true, 503); } });
registerAdapter({ id: 'anthropic', label: 'fake-ok', defaultModel: 'y', models: [], endpointConfigurable: false, pricing: () => ({ input: 5, output: 25 }),
  async analyze(cfg, req) { seen.push({ provider: 'anthropic', key: cfg.apiKey, images: req.images.length }); return { json: modelOutput, raw: '', tokensIn: 9000, tokensOut: 600, model: 'claude-test-2026' }; } });

let T = '', CHK = '';
beforeAll(() => {
  openDb();
  sql.insert('subscription_plans', { id: 'p', name: 'P', price_month_usd: 1, limits_json: '{}', features_json: '{}' });
  T = newId('ten');
  sql.insert('tenants', { id: T, name: 'AI', slug: 'ai', status: 'active', plan_id: 'p', data_key_wrapped: crypto.newWrappedDataKey(), created_at: nowIso() });
  const br = newId('br'); sql.insert('branches', { id: br, tenant_id: T, name: 'B', chairs: 1 });
  const [proto] = seedTenantDefaults(T);
  const pid = newId('pat');
  sql.insert('patients', { id: pid, tenant_id: T, branch_id: br, first_name: 'A', last_name: 'B', protocol_id: proto, status: 'active', consent_json: j.str({ photos: true, ai_processing: true }), created_at: nowIso() });
  const plan = newId('pln'); const start = addDays(today(), -60);
  sql.insert('treatment_plans', { id: plan, tenant_id: T, patient_id: pid, total_upper: 20, total_lower: 20, stage_days: 14, start_date: start, current_stage: 5, status: 'active', created_at: nowIso() });
  for (const s of generateStages(start, 20, 14)) sql.insert('plan_stages', { id: newId('stg'), tenant_id: T, plan_id: plan, ...s, status: s.stage_no === 5 ? 'active' : 'upcoming' });
  sql.insert('attachments', { id: newId('att'), tenant_id: T, plan_id: plan, tooth_fdi: 13, type: 'optimized', placed_stage: 1 });
  CHK = newId('chk');
  sql.insert('checkins', { id: CHK, tenant_id: T, patient_id: pid, plan_id: plan, client_uuid: 'u1', stage_no: 5, status: 'awaiting_review', created_at: nowIso() });
  storeImage(fs.readFileSync(path.join(__dirname, '..', 'seed-assets', 'front_gap_a.jpg')), { tenantId: T, patientId: pid, ownerType: 'checkin', ownerId: CHK, view: 'front', withAligner: true });
  const cfg = (provider: string, priority: number, key: string, perCall = 1) => sql.insert('ai_provider_configs', { id: newId('aip'), scope: 'tenant', tenant_id: T, provider, label: provider, model: 'm',
    key_ciphertext: crypto.encryptString(key, tenantKey(T)), key_last4: key.slice(-4), services_json: j.str(['observations']), priority, monthly_budget_usd: 10, per_call_max_usd: perCall, enabled: 1, created_at: nowIso() });
  cfg('openai', 1, 'sk-openai-secret-1111');
  cfg('anthropic', 2, 'sk-ant-secret-2222');
});

describe('provider router + observation service', () => {
  it('falls back to the next provider, decrypts keys only for the call, and logs every attempt', async () => {
    const out = await analyzeCheckin(T, CHK);
    expect(out.status).toBe('completed');
    expect(seen.map((s) => s.provider)).toEqual(['openai', 'anthropic']);
    expect(seen[1].key).toBe('sk-ant-secret-2222');
    const runs = sql.all('SELECT status, model_version, cost_usd FROM ai_runs ORDER BY created_at');
    expect(runs.map((r) => r.status)).toEqual(['error', 'fallback']);
    expect(runs[1].model_version).toBe('claude-test-2026');
    expect(runs[1].cost_usd).toBeCloseTo((9000 * 5 + 600 * 25) / 1e6, 6);
  });

  it('stores findings with the clinical boundary enforced', () => {
    const f = sql.all('SELECT * FROM findings WHERE checkin_id = ? ORDER BY category', CHK);
    const gap = f.find((x) => x.category === 'tracking_gap')!;
    expect(gap.assessment).toBe('possible'); // "definite" from the model is clamped
    expect(gap.model_version).toBe('claude-test-2026');
    expect(gap.prompt_version).toBe('obs-prompt-v3');
    expect(gap.patient_visible).toBe(0);
    const obscured = f.find((x) => x.category === 'attachment_obscured')!;
    expect(obscured.assessment).toBe('cannot_assess');
  });

  it('skips providers whose per-call ceiling would be exceeded', async () => {
    sql.run('UPDATE ai_provider_configs SET per_call_max_usd = 0.0001');
    const out = await analyzeCheckin(T, CHK);
    expect(out.status).toBe('budget');
    expect(sql.get("SELECT COUNT(*) AS n FROM ai_runs WHERE status = 'skipped'").n).toBe(2);
  });

  it('never sends images without AI-processing consent', async () => {
    sql.run("UPDATE patients SET consent_json = ?", j.str({ photos: true, ai_processing: false }));
    seen.length = 0;
    const out = await analyzeCheckin(T, CHK);
    expect(out.status).toBe('no_consent');
    expect(seen).toHaveLength(0);
  });
});
