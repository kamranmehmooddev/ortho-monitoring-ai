import { sql, j } from '../db/db.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { decryptString, signWebhook } from '../security/crypto.js';
import { tenantKey } from './storage.js';

export const WEBHOOK_EVENTS = ['patient.created', 'plan.updated', 'checkin.submitted', 'checkin.reviewed', 'decision.made', 'stage.advanced',
  'issue.reported', 'appointment.recommended', 'appointment.booked', 'appointment.updated'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
const BACKOFF_MIN = [1, 5, 30, 120, 720];

/** Enqueue an event for every subscribed endpoint (transactional outbox). Payloads carry ids, never images. */
export function emit(tenantId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const eps = sql.all('SELECT * FROM webhook_endpoints WHERE tenant_id = ? AND enabled = 1', tenantId);
  for (const ep of eps) {
    if (!j.parse<string[]>(ep.events_json, []).includes(event)) continue;
    const id = newId('evt');
    sql.insert('webhook_deliveries', {
      id: newId('whd'), tenant_id: tenantId, endpoint_id: ep.id, event,
      payload_json: j.str({ id, type: event, created_at: nowIso(), tenant_id: tenantId, data }), status: 'pending', attempts: 0, next_attempt_at: nowIso(), created_at: nowIso(),
    });
  }
}

export async function deliverPending(limit = 20) {
  const due = sql.all("SELECT d.*, e.url, e.secret_ciphertext, e.consecutive_failures FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id WHERE d.status = 'pending' AND d.next_attempt_at <= ? AND e.enabled = 1 ORDER BY d.next_attempt_at LIMIT ?", nowIso(), limit);
  for (const d of due) {
    const secret = decryptString(d.secret_ciphertext, tenantKey(d.tenant_id));
    const body = d.payload_json;
    let code = 0, err: string | null = null;
    try {
      const res = await fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-oma-signature': signWebhook(secret, body), 'x-oma-event': d.event, 'user-agent': 'OrthoMonitoringAI-Webhooks/1.0' }, body, signal: AbortSignal.timeout(10_000) });
      code = res.status;
    } catch (e) { err = (e as Error).message; }
    const ok = code >= 200 && code < 300;
    const attempts = d.attempts + 1;
    if (ok) {
      sql.update('webhook_deliveries', d.id, d.tenant_id, { status: 'delivered', attempts, response_code: code, last_error: null });
      sql.run('UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE id = ?', d.endpoint_id);
    } else {
      const giveUp = attempts > BACKOFF_MIN.length;
      sql.update('webhook_deliveries', d.id, d.tenant_id, { status: giveUp ? 'failed' : 'pending', attempts, response_code: code || null, last_error: err ?? `HTTP ${code}`,
        next_attempt_at: new Date(Date.now() + (BACKOFF_MIN[attempts - 1] ?? 720) * 60_000).toISOString() });
      const fails = d.consecutive_failures + 1;
      sql.run('UPDATE webhook_endpoints SET consecutive_failures = ?, enabled = CASE WHEN ? >= 20 THEN 0 ELSE enabled END WHERE id = ?', fails, fails, d.endpoint_id);
    }
  }
  return due.length;
}
