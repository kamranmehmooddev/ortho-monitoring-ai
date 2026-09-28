import { sql, j } from '../../db/db.js';
import { newId } from '../../lib/ids.js';
import { nowIso } from '../../lib/time.js';
import { decryptString, sha256, decryptWithMaster } from '../../security/crypto.js';
import { tenantKey } from '../storage.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { geminiAdapter } from './adapters/gemini.js';
import { openaiAdapter } from './adapters/openai.js';
import { openaiCompatibleAdapter } from './adapters/openaiCompatible.js';
import { ProviderError, estimateCostUsd, type AiService, type ProviderAdapter, type ProviderId, type VisionRequest, type VisionResponse } from './types.js';

const adapters = new Map<ProviderId, ProviderAdapter>([
  [anthropicAdapter.id, anthropicAdapter], [openaiAdapter.id, openaiAdapter],
  [geminiAdapter.id, geminiAdapter], [openaiCompatibleAdapter.id, openaiCompatibleAdapter],
]);
export const listAdapters = () => [...adapters.values()].map((a) => ({ id: a.id, label: a.label, defaultModel: a.defaultModel, models: a.models, endpointConfigurable: a.endpointConfigurable }));
export const getAdapter = (id: string) => adapters.get(id as ProviderId);
/** Test hook: swap an adapter implementation (e.g. a recorded-response fake in unit tests). */
export function registerAdapter(a: ProviderAdapter) { adapters.set(a.id, a); }

export interface RouteResult { ok: true; response: VisionResponse; runId: string; provider: string; model: string; attempts: RouteAttempt[] }
export interface RouteFailure { ok: false; reason: 'no_provider' | 'budget' | 'all_failed' | 'consent'; message: string; attempts: RouteAttempt[] }
export interface RouteAttempt { configId: string; provider: string; model: string; status: 'ok' | 'error' | 'skipped_budget'; error?: string }

function monthSpend(configId: string): number {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  return sql.get<{ s: number }>('SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_runs WHERE config_id = ? AND created_at >= ?', configId, start.toISOString())?.s ?? 0;
}

/** Ordered provider chain: clinic configs (by priority), then platform configs if the plan allows. */
export function providerChain(tenantId: string, service: AiService) {
  const t = sql.get('SELECT t.*, p.features_json FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.plan_id WHERE t.id = ?', tenantId);
  const features = j.parse<Record<string, unknown>>(t?.features_json, {});
  const clinic = sql.all("SELECT * FROM ai_provider_configs WHERE scope = 'tenant' AND tenant_id = ? AND enabled = 1 ORDER BY priority", tenantId);
  const platform = features.platformAi ? sql.all("SELECT * FROM ai_provider_configs WHERE scope = 'platform' AND enabled = 1 ORDER BY priority") : [];
  return [...clinic, ...platform].filter((c) => j.parse<string[]>(c.services_json, []).includes(service));
}

export async function routeVision(tenantId: string, service: AiService, req: VisionRequest, meta: { promptVersion: string; subjectId?: string }): Promise<RouteResult | RouteFailure> {
  const chain = providerChain(tenantId, service);
  const attempts: RouteAttempt[] = [];
  if (!chain.length) return { ok: false, reason: 'no_provider', message: 'No AI provider is configured for this clinic', attempts };
  const inputHash = sha256(req.system + req.user + req.images.map((i) => sha256(i.data)).join(''));

  for (const cfg of chain) {
    const adapter = adapters.get(cfg.provider);
    if (!adapter) continue;
    const est = estimateCostUsd(adapter, cfg.model, req);
    if (est > cfg.per_call_max_usd || monthSpend(cfg.id) + est > cfg.monthly_budget_usd) {
      attempts.push({ configId: cfg.id, provider: cfg.provider, model: cfg.model, status: 'skipped_budget' });
      logRun(tenantId, service, cfg, meta, inputHash, { status: 'skipped', error: `Budget: est $${est.toFixed(4)}` });
      continue;
    }
    const apiKey = cfg.scope === 'tenant' ? decryptString(cfg.key_ciphertext, tenantKey(tenantId)) : decryptWithMaster(cfg.key_ciphertext);
    const t0 = Date.now();
    try {
      const response = await adapter.analyze({ id: cfg.id, provider: cfg.provider, model: cfg.model, endpoint: cfg.endpoint, apiKey }, req);
      const p = adapter.pricing(cfg.model);
      const cost = (response.tokensIn * p.input + response.tokensOut * p.output) / 1_000_000;
      const runId = logRun(tenantId, service, cfg, meta, inputHash, {
        status: attempts.length ? 'fallback' : 'ok', latency: Date.now() - t0, tokensIn: response.tokensIn, tokensOut: response.tokensOut, cost, modelVersion: response.model,
      });
      attempts.push({ configId: cfg.id, provider: cfg.provider, model: cfg.model, status: 'ok' });
      return { ok: true, response, runId, provider: cfg.provider, model: response.model, attempts };
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, true);
      logRun(tenantId, service, cfg, meta, inputHash, { status: 'error', latency: Date.now() - t0, error: err.message });
      attempts.push({ configId: cfg.id, provider: cfg.provider, model: cfg.model, status: 'error', error: err.message });
    }
  }
  const allBudget = attempts.every((a) => a.status === 'skipped_budget');
  return { ok: false, reason: allBudget ? 'budget' : 'all_failed', message: allBudget ? 'AI spending limit reached' : 'All configured AI providers failed', attempts };
}

function logRun(tenantId: string, service: string, cfg: any, meta: { promptVersion: string; subjectId?: string }, inputHash: string,
  r: { status: string; latency?: number; tokensIn?: number; tokensOut?: number; cost?: number; error?: string; modelVersion?: string }) {
  const id = newId('air');
  sql.insert('ai_runs', {
    id, tenant_id: tenantId, service, provider: cfg.provider, config_id: cfg.id, model: cfg.model, model_version: r.modelVersion ?? cfg.model,
    prompt_version: meta.promptVersion, input_hash: inputHash, latency_ms: r.latency ?? 0, tokens_in: r.tokensIn ?? 0, tokens_out: r.tokensOut ?? 0,
    cost_usd: r.cost ?? 0, status: r.status, error: r.error ?? null, subject_id: meta.subjectId ?? null, created_at: nowIso(),
  });
  return id;
}
