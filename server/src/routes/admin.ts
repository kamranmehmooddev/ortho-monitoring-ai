import { Router } from 'express';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addDays, nowIso, today } from '../lib/time.js';
import { platform } from '../security/auth.js';
import { encryptWithMaster, hashPassword, newWrappedDataKey, randomToken } from '../security/crypto.js';
import { auditReq, verifyChain } from '../services/audit.js';
import { getAdapter, listAdapters } from '../services/ai/router.js';
import { evaluationSummary } from '../services/evaluation/metrics.js';
import { seedTenantDefaults } from '../db/defaults.js';
import { serializeProvider } from './settings.js';

/** Super admin console API. Platform admins manage tenants but have NO access to patient records or images. */
export const adminRouter = Router();
adminRouter.use((req, _res, next) => { try { platform(req); next(); } catch (e) { next(e); } });

adminRouter.get('/overview', h(() => {
  const month = today().slice(0, 8) + '01';
  const tenants = sql.all('SELECT t.*, p.name AS plan, p.price_month_usd FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.plan_id');
  const activeTenants = tenants.filter((t) => t.status === 'active');
  const aiRuns = sql.get(`SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, COALESCE(SUM(cost_usd),0) AS cost, AVG(latency_ms) AS latency FROM ai_runs WHERE created_at >= ?`, month);
  const daily = sql.all(`SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM checkins WHERE created_at >= ? GROUP BY d ORDER BY d`, addDays(today(), -29));
  return {
    kpis: {
      tenants: tenants.length, activeTenants: activeTenants.length, mrr: activeTenants.reduce((s, t) => s + (t.price_month_usd ?? 0), 0),
      activePatients: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM patients WHERE status = 'active'")?.n ?? 0,
      checkinsThisMonth: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM checkins WHERE created_at >= ?', month)?.n ?? 0,
      aiCallsThisMonth: aiRuns?.n ?? 0, aiErrorRate: aiRuns?.n ? (aiRuns.errors ?? 0) / aiRuns.n : 0, aiCostThisMonth: aiRuns?.cost ?? 0, aiAvgLatencyMs: aiRuns?.latency ?? null,
      webhookFailures: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status = 'failed' AND created_at >= ?", month)?.n ?? 0,
    },
    checkinsDaily: daily,
    planMix: sql.all('SELECT p.name, COUNT(t.id) AS n FROM subscription_plans p LEFT JOIN tenants t ON t.plan_id = p.id GROUP BY p.id ORDER BY p.price_month_usd'),
  };
}));

adminRouter.get('/tenants', h(() => sql.all('SELECT t.*, p.name AS plan_name, p.limits_json FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.plan_id ORDER BY t.created_at DESC').map((t) => {
  const limits = j.parse<Record<string, number>>(t.limits_json, {});
  const patients = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM patients WHERE tenant_id = ? AND status IN ('active','invited')", t.id)?.n ?? 0;
  return { id: t.id, name: t.name, slug: t.slug, status: t.status, planId: t.plan_id, planName: t.plan_name, createdAt: t.created_at,
    usage: { activePatients: patients, patientLimit: limits.activePatients ?? null,
      branches: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ?', t.id)?.n ?? 0,
      seats: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status = 'active'", t.id)?.n ?? 0,
      checkins30d: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM checkins WHERE tenant_id = ? AND created_at >= ?', t.id, addDays(today(), -30))?.n ?? 0,
      aiCost30d: sql.get<{ s: number }>('SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_runs WHERE tenant_id = ? AND created_at >= ?', t.id, addDays(today(), -30))?.s ?? 0 },
    onboarding: j.parse(t.onboarding_json, {}) };
})));

adminRouter.post('/tenants', h((req) => {
  const b = z.object({ name: z.string().min(2), slug: z.string().regex(/^[a-z0-9-]{3,40}$/), planId: z.string(), adminName: z.string().min(2), adminEmail: z.string().email(), branchName: z.string().default('Main clinic'), timezone: z.string().default('UTC') }).parse(req.body);
  if (sql.get('SELECT id FROM tenants WHERE slug = ?', b.slug)) throw badRequest('Slug already in use');
  if (sql.get('SELECT id FROM users WHERE email = ?', b.adminEmail.toLowerCase())) throw badRequest('Admin email already in use');
  if (!sql.get('SELECT id FROM subscription_plans WHERE id = ?', b.planId)) throw badRequest('Unknown plan');
  const id = newId('ten');
  const temp = randomToken(9);
  sql.tx(() => {
    sql.insert('tenants', { id, name: b.name, slug: b.slug, status: 'trial', plan_id: b.planId, branding_json: j.str({ accent: '#0F6E6A', displayName: b.name }), settings_json: '{}', data_key_wrapped: newWrappedDataKey(), onboarding_json: '{}', created_at: nowIso() });
    const branchId = newId('br');
    sql.insert('branches', { id: branchId, tenant_id: id, name: b.branchName, timezone: b.timezone, chairs: 3, hours_json: '{}' });
    sql.insert('users', { id: newId('usr'), tenant_id: id, email: b.adminEmail.toLowerCase(), name: b.adminName, password_hash: hashPassword(temp), role: 'clinic_admin', title: 'Clinic admin', branch_ids_json: '[]', status: 'active', created_at: nowIso() });
    seedTenantDefaults(id);
  });
  auditReq(req, 'tenant.create', 'tenant', id, { meta: { slug: b.slug, planId: b.planId } });
  return { id, adminEmail: b.adminEmail, temporaryPassword: temp };
}));

adminRouter.patch('/tenants/:id', h((req) => {
  const b = z.object({ status: z.enum(['trial', 'active', 'suspended']).optional(), planId: z.string().optional() }).parse(req.body);
  const t = sql.get('SELECT * FROM tenants WHERE id = ?', req.params.id);
  if (!t) throw notFound('Tenant');
  sql.update('tenants', t.id, null, { ...(b.status ? { status: b.status } : {}), ...(b.planId ? { plan_id: b.planId } : {}) });
  auditReq(req, 'tenant.update', 'tenant', t.id, { meta: b });
  return { ok: true };
}));

adminRouter.get('/plans', h(() => sql.all('SELECT * FROM subscription_plans ORDER BY price_month_usd').map((p) => ({ id: p.id, name: p.name, priceMonthUsd: p.price_month_usd, limits: j.parse(p.limits_json, {}), features: j.parse(p.features_json, {}),
  tenants: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM tenants WHERE plan_id = ?', p.id)?.n ?? 0 }))));

adminRouter.get('/ai-providers', h(() => ({ adapters: listAdapters(), configs: sql.all("SELECT * FROM ai_provider_configs WHERE scope = 'platform' ORDER BY priority").map(serializeProvider) })));
adminRouter.post('/ai-providers', h((req) => {
  const b = z.object({ provider: z.enum(['anthropic', 'openai', 'gemini', 'openai_compatible']), label: z.string().min(2), model: z.string().min(2), endpoint: z.string().url().nullable().optional(), apiKey: z.string().min(8),
    priority: z.number().int().default(1), monthlyBudgetUsd: z.number().min(1).default(500), perCallMaxUsd: z.number().min(0.01).default(0.5) }).parse(req.body);
  if (getAdapter(b.provider)?.endpointConfigurable && !b.endpoint) throw badRequest('Endpoint required');
  const id = newId('aip');
  sql.insert('ai_provider_configs', { id, scope: 'platform', tenant_id: null, provider: b.provider, label: b.label, model: b.model, endpoint: b.endpoint ?? null, key_ciphertext: encryptWithMaster(b.apiKey.trim()),
    key_last4: b.apiKey.trim().slice(-4), services_json: j.str(['observations']), priority: b.priority, monthly_budget_usd: b.monthlyBudgetUsd, per_call_max_usd: b.perCallMaxUsd, enabled: 1, created_by: req.ctx?.kind === 'platform' ? req.ctx.userId : null, created_at: nowIso() });
  auditReq(req, 'platform_ai.create', 'ai_provider', id, { meta: { provider: b.provider, model: b.model } });
  return serializeProvider(sql.get('SELECT * FROM ai_provider_configs WHERE id = ?', id));
}));
adminRouter.patch('/ai-providers/:id', h((req) => {
  const b = z.object({ enabled: z.boolean().optional(), priority: z.number().int().optional(), monthlyBudgetUsd: z.number().optional() }).parse(req.body);
  sql.update('ai_provider_configs', req.params.id, null, { ...(b.enabled !== undefined ? { enabled: b.enabled ? 1 : 0 } : {}), ...(b.priority ? { priority: b.priority } : {}), ...(b.monthlyBudgetUsd ? { monthly_budget_usd: b.monthlyBudgetUsd } : {}) });
  auditReq(req, 'platform_ai.update', 'ai_provider', req.params.id, { meta: b });
  return { ok: true };
}));

adminRouter.get('/model-registry', h(() => ({ ...evaluationSummary(null, addDays(today(), -90)),
  versions: [
    { service: 'quality', version: 'quality-v1.2', kind: 'Deterministic signal processing', status: 'active' },
    { service: 'observations', version: 'obs-prompt-v3', kind: 'LLM prompt + schema (provider-agnostic)', status: 'active' },
    { service: 'gonogo', version: 'gonogo-v1', kind: 'Rules engine', status: 'active' },
    { service: 'triage', version: 'triage-v1', kind: 'Rules engine', status: 'active' },
    { service: 'appointments', version: 'appt-v1', kind: 'Rules engine', status: 'active' },
    { service: 'instructions', version: 'instr-parse-v1', kind: 'Deterministic parser', status: 'active' },
  ] })));

adminRouter.get('/audit', h(() => sql.all('SELECT * FROM audit_log WHERE tenant_id IS NULL ORDER BY seq DESC LIMIT 200').map((a) => ({ id: a.id, actorName: a.actor_name, actorType: a.actor_type, action: a.action, entity: a.entity, entityId: a.entity_id, meta: j.parse(a.meta_json, null), createdAt: a.created_at }))));
adminRouter.get('/audit/verify', h(() => verifyChain(null)));

adminRouter.get('/health', h(() => ({
  status: 'ok', time: nowIso(), node: process.version,
  db: { patients: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM patients')?.n, images: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM images')?.n },
  webhooksPending: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status = 'pending'")?.n,
  aiLast24h: sql.all("SELECT provider, status, COUNT(*) AS n FROM ai_runs WHERE created_at >= datetime('now','-1 day') GROUP BY provider, status"),
})));
