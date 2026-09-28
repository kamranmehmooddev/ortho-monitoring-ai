import { Router } from 'express';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound, HttpError } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addDays, nowIso, today } from '../lib/time.js';
import { isProd } from '../config.js';
import { requireStaff, staff } from '../security/auth.js';
import { encryptString, hashPassword, randomToken, sha256 } from '../security/crypto.js';
import { ROLE_LABELS, ROLE_PERMISSIONS, type Role } from '../security/rbac.js';
import { auditReq, verifyChain } from '../services/audit.js';
import { tenantKey } from '../services/storage.js';
import { getAdapter, listAdapters } from '../services/ai/router.js';
import { tenantRules } from '../services/review.js';
import { retentionOf } from '../services/retention.js';
import { evaluationSummary } from '../services/evaluation/metrics.js';
import { WEBHOOK_EVENTS } from '../services/webhooks.js';
import { DEFAULT_GO_CRITERIA } from '../services/scheduling/gonogo.js';
import { VIEWS } from '../services/observations/schema.js';

export const settingsRouter = Router();

// ── Clinic profile, branding, branches ───────────────────────────────────────
settingsRouter.get('/settings/clinic', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  const t = sql.get('SELECT t.*, p.name AS plan_name, p.limits_json, p.features_json, p.price_month_usd FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.plan_id WHERE t.id = ?', c.tenantId)!;
  const month = new Date(); month.setUTCDate(1);
  const usage = {
    activePatients: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM patients WHERE tenant_id = ? AND status IN ('active','invited')", c.tenantId)?.n ?? 0,
    branches: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ?', c.tenantId)?.n ?? 0,
    seats: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status = 'active'", c.tenantId)?.n ?? 0,
    checkinsThisMonth: sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM checkins WHERE tenant_id = ? AND created_at >= ?', c.tenantId, month.toISOString().slice(0, 10))?.n ?? 0,
    aiCallsThisMonth: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_runs WHERE tenant_id = ? AND created_at >= ? AND status IN ('ok','fallback')", c.tenantId, month.toISOString().slice(0, 10))?.n ?? 0,
    aiCostThisMonth: sql.get<{ s: number }>('SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_runs WHERE tenant_id = ? AND created_at >= ?', c.tenantId, month.toISOString().slice(0, 10))?.s ?? 0,
    storageMb: Math.round((sql.get<{ s: number }>('SELECT COALESCE(SUM(bytes),0) AS s FROM images WHERE tenant_id = ?', c.tenantId)?.s ?? 0) / 1048576),
  };
  return {
    id: t.id, name: t.name, slug: t.slug, status: t.status, branding: j.parse(t.branding_json, {}), onboarding: j.parse(t.onboarding_json, {}),
    plan: { id: t.plan_id, name: t.plan_name, priceMonthUsd: t.price_month_usd, limits: j.parse(t.limits_json, {}), features: j.parse(t.features_json, {}) }, usage,
    branches: sql.all('SELECT * FROM branches WHERE tenant_id = ? ORDER BY name', c.tenantId).map((b) => ({ id: b.id, name: b.name, timezone: b.timezone, address: b.address, chairs: b.chairs, hours: j.parse(b.hours_json, {}) })),
    scheduling: tenantRules(c.tenantId), retention: retentionOf(c.tenantId),
  };
}));

settingsRouter.put('/settings/clinic', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ name: z.string().min(2).max(120).optional(), branding: z.object({ accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), displayName: z.string().max(80).optional(), logoText: z.string().max(4).optional(), patientWelcome: z.string().max(300).optional() }).optional() }).parse(req.body);
  const t = sql.get('SELECT * FROM tenants WHERE id = ?', c.tenantId)!;
  if (b.branding?.accent && contrastWithWhite(b.branding.accent) < 4.5) throw badRequest('Accent colour needs a contrast ratio of at least 4.5:1 against white text for accessibility');
  sql.update('tenants', c.tenantId, null, { name: b.name ?? t.name, branding_json: j.str({ ...j.parse(t.branding_json, {}), ...(b.branding ?? {}) }) });
  auditReq(req, 'settings.clinic', 'tenant', c.tenantId, { meta: b });
  return { ok: true };
}));

function contrastWithWhite(hex: string) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (L + 0.05);
}

settingsRouter.post('/settings/branches', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ name: z.string().min(2), timezone: z.string().default('UTC'), address: z.string().optional(), chairs: z.number().int().min(1).max(30).default(3) }).parse(req.body);
  const plan = sql.get('SELECT p.limits_json FROM tenants t JOIN subscription_plans p ON p.id = t.plan_id WHERE t.id = ?', c.tenantId);
  const max = j.parse<{ branches?: number }>(plan?.limits_json, {}).branches;
  const n = sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM branches WHERE tenant_id = ?', c.tenantId)?.n ?? 0;
  if (max && n >= max) throw new HttpError(402, `Your plan includes ${max} branch${max === 1 ? '' : 'es'}`, 'plan_limit');
  const id = newId('br');
  sql.insert('branches', { id, tenant_id: c.tenantId, name: b.name, timezone: b.timezone, address: b.address ?? null, chairs: b.chairs, hours_json: '{}' });
  auditReq(req, 'branch.create', 'branch', id);
  return { id };
}));

settingsRouter.put('/settings/scheduling', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({
    durations: z.record(z.string(), z.number().int().min(5).max(240)).optional(), bufferMin: z.number().int().min(0).max(30).optional(), maxLongPerDay: z.number().int().min(1).max(30).optional(),
    slotStepMin: z.number().int().min(5).max(60).optional(), sharedSetupMin: z.number().int().min(0).max(30).optional(), visitEveryStages: z.number().int().min(1).max(20).nullable().optional(),
    lunch: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
  }).parse(req.body);
  const t = sql.get('SELECT settings_json FROM tenants WHERE id = ?', c.tenantId)!;
  const s = j.parse<Record<string, any>>(t.settings_json, {});
  s.scheduling = { ...(s.scheduling ?? {}), ...b, durations: { ...(s.scheduling?.durations ?? {}), ...(b.durations ?? {}) } };
  sql.update('tenants', c.tenantId, null, { settings_json: j.str(s) });
  auditReq(req, 'settings.scheduling', 'tenant', c.tenantId, { meta: b });
  return tenantRules(c.tenantId);
}));

settingsRouter.put('/settings/retention', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ imagesDays: z.number().int().min(365).max(36500), messagesDays: z.number().int().min(90).max(36500), purgeAfterTreatmentDays: z.number().int().min(365).max(36500), auditYears: z.number().int().min(6).max(30) }).parse(req.body);
  const t = sql.get('SELECT settings_json FROM tenants WHERE id = ?', c.tenantId)!;
  const s = j.parse<Record<string, any>>(t.settings_json, {});
  s.retention = b;
  sql.update('tenants', c.tenantId, null, { settings_json: j.str(s) });
  auditReq(req, 'settings.retention', 'tenant', c.tenantId, { meta: b });
  return retentionOf(c.tenantId);
}));

// ── Team & roles ─────────────────────────────────────────────────────────────
settingsRouter.get('/team', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  return {
    roles: Object.entries(ROLE_LABELS).filter(([r]) => r !== 'platform_admin').map(([id, label]) => ({ id, label, permissions: ROLE_PERMISSIONS[id as Role] })),
    members: sql.all('SELECT * FROM users WHERE tenant_id = ? ORDER BY name', c.tenantId).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: ROLE_LABELS[u.role as Role], title: u.title, status: u.status, branchIds: j.parse(u.branch_ids_json, []), lastLoginAt: u.last_login_at })),
  };
}));

settingsRouter.post('/team', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ name: z.string().min(2), email: z.string().email(), role: z.enum(['clinic_admin', 'orthodontist', 'dentist', 'treatment_coordinator', 'front_desk', 'read_only']), title: z.string().optional(), branchIds: z.array(z.string()).default([]) }).parse(req.body);
  if (sql.get('SELECT id FROM users WHERE email = ?', b.email.toLowerCase())) throw badRequest('A user with this email already exists');
  const plan = sql.get('SELECT p.limits_json FROM tenants t JOIN subscription_plans p ON p.id = t.plan_id WHERE t.id = ?', c.tenantId);
  const max = j.parse<{ seats?: number }>(plan?.limits_json, {}).seats;
  const n = sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status = 'active'", c.tenantId)?.n ?? 0;
  if (max && n >= max) throw new HttpError(402, `Your plan includes ${max} seats`, 'plan_limit');
  const temp = randomToken(9);
  const id = newId('usr');
  sql.insert('users', { id, tenant_id: c.tenantId, email: b.email.toLowerCase(), name: b.name, password_hash: hashPassword(temp), role: b.role, title: b.title ?? null, branch_ids_json: j.str(b.branchIds), status: 'active', created_at: nowIso() });
  auditReq(req, 'team.invite', 'user', id, { meta: { role: b.role } });
  return { id, temporaryPassword: temp };
}));

settingsRouter.patch('/team/:id', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ role: z.enum(['clinic_admin', 'orthodontist', 'dentist', 'treatment_coordinator', 'front_desk', 'read_only']).optional(), status: z.enum(['active', 'disabled']).optional(), branchIds: z.array(z.string()).optional() }).parse(req.body);
  const u = sql.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  if (!u) throw notFound('User');
  if (u.id === c.userId && (b.role && b.role !== 'clinic_admin' || b.status === 'disabled')) throw badRequest('You cannot remove your own admin access');
  sql.update('users', u.id, c.tenantId, { ...(b.role ? { role: b.role } : {}), ...(b.status ? { status: b.status } : {}), ...(b.branchIds ? { branch_ids_json: j.str(b.branchIds) } : {}) });
  auditReq(req, 'team.update', 'user', u.id, { meta: b });
  return { ok: true };
}));

// ── Protocols ────────────────────────────────────────────────────────────────
settingsRouter.get('/protocols', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  return sql.all('SELECT * FROM protocols WHERE tenant_id = ? ORDER BY name', c.tenantId).map((p) => ({ id: p.id, name: p.name, mode: p.mode, description: p.description, intervalDays: p.checkin_interval_days,
    requiredViews: j.parse(p.required_views_json, []), criteria: { ...DEFAULT_GO_CRITERIA, ...j.parse(p.go_criteria_json, {}) }, graceHours: p.grace_hours, reminders: j.parse(p.reminder_json, {}),
    patients: sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM patients WHERE protocol_id = ? AND status = 'active'", p.id)?.n ?? 0 }));
}));

const ProtocolBody = z.object({ name: z.string().min(2), mode: z.enum(['aligner', 'fixed', 'retention']), description: z.string().optional(), intervalDays: z.number().int().min(2).max(60),
  requiredViews: z.array(z.object({ view: z.enum(VIEWS), with_aligner: z.boolean() })).min(1), graceHours: z.number().int().min(0).max(168).default(48),
  criteria: z.object({ toleranceDays: z.number().int().min(0).max(7), minWearHours: z.number().min(12).max(24), requireAllViews: z.boolean() }).partial().default({}) });

settingsRouter.post('/protocols', requireStaff('library.manage'), h((req) => {
  const c = staff(req);
  const b = ProtocolBody.parse(req.body);
  const id = newId('prt');
  sql.insert('protocols', { id, tenant_id: c.tenantId, name: b.name, mode: b.mode, description: b.description ?? null, checkin_interval_days: b.intervalDays, required_views_json: j.str(b.requiredViews), go_criteria_json: j.str(b.criteria), grace_hours: b.graceHours, reminder_json: j.str({ hour: 19 }) });
  auditReq(req, 'protocol.create', 'protocol', id);
  return { id };
}));

settingsRouter.put('/protocols/:id', requireStaff('library.manage'), h((req) => {
  const c = staff(req);
  const b = ProtocolBody.parse(req.body);
  if (!sql.get('SELECT id FROM protocols WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId)) throw notFound('Protocol');
  sql.update('protocols', req.params.id, c.tenantId, { name: b.name, mode: b.mode, description: b.description ?? null, checkin_interval_days: b.intervalDays, required_views_json: j.str(b.requiredViews), go_criteria_json: j.str(b.criteria), grace_hours: b.graceHours });
  auditReq(req, 'protocol.update', 'protocol', req.params.id);
  return { ok: true };
}));

// ── Library: instructions & education ───────────────────────────────────────
settingsRouter.get('/instructions', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  return sql.all('SELECT * FROM instructions WHERE tenant_id = ? ORDER BY category, title', c.tenantId).map((i) => ({ id: i.id, title: i.title, body: i.body, category: i.category, tags: j.parse(i.tags_json, []), requiresDoctor: !!i.requires_doctor }));
}));
settingsRouter.post('/instructions', requireStaff('library.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ title: z.string().min(2).max(120), body: z.string().min(2).max(4000), category: z.string().min(2), tags: z.array(z.string()).default([]), requiresDoctor: z.boolean().default(true) }).parse(req.body);
  const id = newId('ins');
  sql.insert('instructions', { id, tenant_id: c.tenantId, title: b.title, body: b.body, category: b.category, tags_json: j.str(b.tags), requires_doctor: b.requiresDoctor, created_at: nowIso() });
  auditReq(req, 'instruction.create', 'instruction', id);
  return { id };
}));
settingsRouter.delete('/instructions/:id', requireStaff('library.manage'), h((req) => {
  const c = staff(req);
  sql.run('DELETE FROM instructions WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  auditReq(req, 'instruction.delete', 'instruction', req.params.id);
  return { ok: true };
}));

settingsRouter.get('/education', requireStaff('patients.read'), h((req) => {
  const c = staff(req);
  return sql.all('SELECT e.*, u.name AS approver FROM education e LEFT JOIN users u ON u.id = e.approved_by WHERE e.tenant_id = ? ORDER BY e.category, e.title', c.tenantId)
    .map((e) => ({ id: e.id, title: e.title, summary: e.summary, body: e.body_md, category: e.category, readMinutes: e.read_minutes, approvedBy: e.approver, published: !!e.published }));
}));
settingsRouter.post('/education', requireStaff('clinical.decide'), h((req) => {
  const c = staff(req);
  const b = z.object({ title: z.string().min(2), summary: z.string().max(300).optional(), body: z.string().min(10), category: z.string(), readMinutes: z.number().int().min(1).max(30).default(2), published: z.boolean().default(true) }).parse(req.body);
  const id = newId('edu');
  sql.insert('education', { id, tenant_id: c.tenantId, title: b.title, summary: b.summary ?? null, body_md: b.body, category: b.category, read_minutes: b.readMinutes, approved_by: c.userId, published: b.published, created_at: nowIso() });
  auditReq(req, 'education.publish', 'education', id);
  return { id };
}));

// ── Leads (smile assessments) ────────────────────────────────────────────────
settingsRouter.get('/leads', requireStaff('leads.manage'), h((req) => {
  const c = staff(req);
  return sql.all('SELECT * FROM leads WHERE tenant_id = ? ORDER BY created_at DESC', c.tenantId).map((l) => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, answers: j.parse(l.answers_json, {}), imageIds: j.parse(l.image_ids_json, []), status: l.status, consentMarketing: !!l.consent_marketing, createdAt: l.created_at }));
}));
settingsRouter.patch('/leads/:id', requireStaff('leads.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ status: z.enum(['new', 'contacted', 'consult_booked', 'converted', 'closed']) }).parse(req.body);
  sql.update('leads', req.params.id, c.tenantId, { status: b.status });
  auditReq(req, 'lead.update', 'lead', req.params.id, { meta: b });
  return { ok: true };
}));

// ── AI providers (Bring Your Own Key) ────────────────────────────────────────
const serializeProvider = (p: any) => ({ id: p.id, scope: p.scope, provider: p.provider, label: p.label, model: p.model, endpoint: p.endpoint, keyLast4: p.key_last4,
  services: j.parse(p.services_json, []), priority: p.priority, monthlyBudgetUsd: p.monthly_budget_usd, perCallMaxUsd: p.per_call_max_usd, enabled: !!p.enabled, createdAt: p.created_at,
  spendThisMonth: sql.get<{ s: number }>("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_runs WHERE config_id = ? AND created_at >= ?", p.id, today().slice(0, 8) + '01')?.s ?? 0,
  lastRun: sql.get("SELECT status, error, created_at, latency_ms FROM ai_runs WHERE config_id = ? ORDER BY created_at DESC LIMIT 1", p.id) ?? null });

export { serializeProvider };

settingsRouter.get('/ai-providers', requireStaff('ai.manage'), h((req) => {
  const c = staff(req);
  const plan = sql.get('SELECT p.features_json FROM tenants t JOIN subscription_plans p ON p.id = t.plan_id WHERE t.id = ?', c.tenantId);
  return {
    adapters: listAdapters(),
    configs: sql.all("SELECT * FROM ai_provider_configs WHERE scope = 'tenant' AND tenant_id = ? ORDER BY priority", c.tenantId).map(serializeProvider),
    platformFallbackAvailable: !!j.parse<{ platformAi?: boolean }>(plan?.features_json, {}).platformAi && !!sql.get("SELECT id FROM ai_provider_configs WHERE scope = 'platform' AND enabled = 1"),
    services: [{ id: 'observations', label: 'Clinical observations (vision)', description: 'Describes possible tracking gaps, attachment and appliance concerns for clinician review.' }],
    separation: [
      { id: 'quality', label: 'Image quality', engine: 'quality-v1.2 (deterministic, no LLM)' },
      { id: 'observations', label: 'Clinical observations', engine: 'obs-prompt-v3 via provider chain' },
      { id: 'scheduling', label: 'Go/no-go & appointments', engine: 'gonogo-v1 · appt-v1 · triage-v1 (deterministic rules)' },
    ],
  };
}));

const ProviderBody = z.object({ provider: z.enum(['anthropic', 'openai', 'gemini', 'openai_compatible']), label: z.string().min(2).max(60), model: z.string().min(2).max(100),
  endpoint: z.string().url().optional().nullable(), apiKey: z.string().min(8).max(500), priority: z.number().int().min(1).max(10).default(1),
  monthlyBudgetUsd: z.number().min(1).max(100000).default(100), perCallMaxUsd: z.number().min(0.01).max(10).default(0.5), services: z.array(z.enum(['observations'])).default(['observations']) });

settingsRouter.post('/ai-providers', requireStaff('ai.manage'), h((req) => {
  const c = staff(req);
  const b = ProviderBody.parse(req.body);
  const adapter = getAdapter(b.provider)!;
  if (adapter.endpointConfigurable && !b.endpoint) throw badRequest('Endpoint URL is required for this provider');
  if (b.endpoint && isProd() && !b.endpoint.startsWith('https://')) throw badRequest('Endpoint must use HTTPS');
  const id = newId('aip');
  sql.insert('ai_provider_configs', { id, scope: 'tenant', tenant_id: c.tenantId, provider: b.provider, label: b.label, model: b.model, endpoint: adapter.endpointConfigurable ? b.endpoint : null,
    key_ciphertext: encryptString(b.apiKey.trim(), tenantKey(c.tenantId)), key_last4: b.apiKey.trim().slice(-4), services_json: j.str(b.services), priority: b.priority,
    monthly_budget_usd: b.monthlyBudgetUsd, per_call_max_usd: b.perCallMaxUsd, enabled: 1, created_by: c.userId, created_at: nowIso() });
  auditReq(req, 'ai_provider.create', 'ai_provider', id, { meta: { provider: b.provider, model: b.model } }); // key never logged
  return serializeProvider(sql.get('SELECT * FROM ai_provider_configs WHERE id = ?', id));
}));

settingsRouter.patch('/ai-providers/:id', requireStaff('ai.manage'), h((req) => {
  const c = staff(req);
  const b = ProviderBody.partial().extend({ enabled: z.boolean().optional() }).parse(req.body);
  const p = sql.get("SELECT * FROM ai_provider_configs WHERE id = ? AND scope = 'tenant' AND tenant_id = ?", req.params.id, c.tenantId);
  if (!p) throw notFound('AI provider');
  const patch: Record<string, unknown> = {};
  if (b.label) patch.label = b.label;
  if (b.model) patch.model = b.model;
  if (b.endpoint !== undefined) patch.endpoint = b.endpoint;
  if (b.priority) patch.priority = b.priority;
  if (b.monthlyBudgetUsd) patch.monthly_budget_usd = b.monthlyBudgetUsd;
  if (b.perCallMaxUsd) patch.per_call_max_usd = b.perCallMaxUsd;
  if (b.enabled !== undefined) patch.enabled = b.enabled ? 1 : 0;
  if (b.apiKey) { patch.key_ciphertext = encryptString(b.apiKey.trim(), tenantKey(c.tenantId)); patch.key_last4 = b.apiKey.trim().slice(-4); }
  sql.update('ai_provider_configs', p.id, c.tenantId, patch);
  auditReq(req, 'ai_provider.update', 'ai_provider', p.id, { meta: { fields: Object.keys(patch).filter((k) => k !== 'key_ciphertext'), keyRotated: !!b.apiKey } });
  return serializeProvider(sql.get('SELECT * FROM ai_provider_configs WHERE id = ?', p.id));
}));

settingsRouter.delete('/ai-providers/:id', requireStaff('ai.manage'), h((req) => {
  const c = staff(req);
  sql.run("DELETE FROM ai_provider_configs WHERE id = ? AND scope = 'tenant' AND tenant_id = ?", req.params.id, c.tenantId);
  auditReq(req, 'ai_provider.delete', 'ai_provider', req.params.id);
  return { ok: true };
}));

// ── API keys & webhooks ──────────────────────────────────────────────────────
export const API_SCOPES = ['patients:read', 'patients:write', 'plans:write', 'appointments:read', 'appointments:write', 'checkins:read', 'decisions:read'];

settingsRouter.get('/api-keys', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  return { scopes: API_SCOPES, keys: sql.all('SELECT * FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC', c.tenantId).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: j.parse(k.scopes_json, []), lastUsedAt: k.last_used_at, revokedAt: k.revoked_at, createdAt: k.created_at })) };
}));
settingsRouter.post('/api-keys', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ name: z.string().min(2).max(60), scopes: z.array(z.enum(API_SCOPES as [string, ...string[]])).min(1) }).parse(req.body);
  const secret = `omk_live_${randomToken(24)}`;
  const id = newId('key');
  sql.insert('api_keys', { id, tenant_id: c.tenantId, name: b.name, prefix: secret.slice(0, 14), key_hash: sha256(secret), scopes_json: j.str(b.scopes), created_at: nowIso() });
  auditReq(req, 'api_key.create', 'api_key', id, { meta: { scopes: b.scopes } });
  return { id, secret, note: 'Copy this key now. It will not be shown again.' };
}));
settingsRouter.delete('/api-keys/:id', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  sql.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ?', nowIso(), req.params.id, c.tenantId);
  auditReq(req, 'api_key.revoke', 'api_key', req.params.id);
  return { ok: true };
}));

settingsRouter.get('/webhooks', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  return {
    events: WEBHOOK_EVENTS,
    endpoints: sql.all('SELECT * FROM webhook_endpoints WHERE tenant_id = ?', c.tenantId).map((e) => ({ id: e.id, url: e.url, events: j.parse(e.events_json, []), enabled: !!e.enabled, consecutiveFailures: e.consecutive_failures, createdAt: e.created_at })),
    deliveries: sql.all('SELECT * FROM webhook_deliveries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 30', c.tenantId).map((d) => ({ id: d.id, endpointId: d.endpoint_id, event: d.event, status: d.status, attempts: d.attempts, responseCode: d.response_code, lastError: d.last_error, createdAt: d.created_at })),
  };
}));
settingsRouter.post('/webhooks', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const b = z.object({ url: z.string().url(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).parse(req.body);
  if (isProd() && !b.url.startsWith('https://')) throw badRequest('Webhook URLs must use HTTPS');
  const secret = `whsec_${randomToken(24)}`;
  const id = newId('whe');
  sql.insert('webhook_endpoints', { id, tenant_id: c.tenantId, url: b.url, secret_ciphertext: encryptString(secret, tenantKey(c.tenantId)), events_json: j.str(b.events), enabled: 1, created_at: nowIso() });
  auditReq(req, 'webhook.create', 'webhook', id, { meta: { url: b.url, events: b.events } });
  return { id, secret, note: 'Use this signing secret to verify the X-OMA-Signature header. It will not be shown again.' };
}));
settingsRouter.delete('/webhooks/:id', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  sql.run('DELETE FROM webhook_endpoints WHERE id = ? AND tenant_id = ?', req.params.id, c.tenantId);
  auditReq(req, 'webhook.delete', 'webhook', req.params.id);
  return { ok: true };
}));

// ── Audit & evaluation ───────────────────────────────────────────────────────
settingsRouter.get('/audit', requireStaff('audit.view'), h((req) => {
  const c = staff(req);
  const patientId = req.query.patientId ? String(req.query.patientId) : null;
  const action = req.query.action ? String(req.query.action) : null;
  const params: unknown[] = [c.tenantId];
  let where = 'tenant_id = ?';
  if (patientId) { where += ' AND patient_id = ?'; params.push(patientId); }
  if (action) { where += ' AND action LIKE ?'; params.push(`${action}%`); }
  return sql.all(`SELECT * FROM audit_log WHERE ${where} ORDER BY seq DESC LIMIT 300`, ...params)
    .map((a) => ({ id: a.id, actorType: a.actor_type, actorName: a.actor_name, action: a.action, entity: a.entity, entityId: a.entity_id, patientId: a.patient_id, ip: a.ip, meta: j.parse(a.meta_json, null), hash: a.hash.slice(0, 12), createdAt: a.created_at }));
}));
settingsRouter.get('/audit/verify', requireStaff('audit.view'), h((req) => verifyChain(staff(req).tenantId)));

settingsRouter.get('/evaluation/summary', requireStaff('evaluation.view'), h((req) => {
  const c = staff(req);
  const days = Number(req.query.days ?? 90);
  return evaluationSummary(c.tenantId, addDays(today(), -days));
}));

settingsRouter.post('/onboarding/:step', requireStaff('settings.manage'), h((req) => {
  const c = staff(req);
  const t = sql.get('SELECT onboarding_json FROM tenants WHERE id = ?', c.tenantId)!;
  const o = j.parse<Record<string, boolean>>(t.onboarding_json, {});
  o[req.params.step] = true;
  sql.update('tenants', c.tenantId, null, { onboarding_json: j.str(o) });
  return o;
}));
