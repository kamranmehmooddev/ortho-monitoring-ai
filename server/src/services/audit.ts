import type { Request } from 'express';
import { sql, j } from '../db/db.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { sha256 } from '../security/crypto.js';

export interface AuditEntry {
  tenantId: string | null; actorType: string; actorId?: string | null; actorName?: string | null;
  action: string; entity?: string; entityId?: string; patientId?: string | null; ip?: string | null; meta?: unknown;
}

const canonical = (e: Record<string, unknown>) => JSON.stringify(Object.keys(e).sort().map((k) => [k, e[k]]));

/** Append-only, hash-chained audit log (per tenant chain; platform events use tenant_id NULL). */
export function audit(e: AuditEntry) {
  const prev = e.tenantId
    ? sql.get<{ hash: string }>('SELECT hash FROM audit_log WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1', e.tenantId)
    : sql.get<{ hash: string }>('SELECT hash FROM audit_log WHERE tenant_id IS NULL ORDER BY seq DESC LIMIT 1');
  const row = {
    id: newId('aud'), tenant_id: e.tenantId, actor_type: e.actorType, actor_id: e.actorId ?? null, actor_name: e.actorName ?? null,
    action: e.action, entity: e.entity ?? null, entity_id: e.entityId ?? null, patient_id: e.patientId ?? null,
    ip: e.ip ?? null, meta_json: e.meta === undefined ? null : j.str(e.meta), prev_hash: prev?.hash ?? 'genesis', created_at: nowIso(),
  };
  const hash = sha256(row.prev_hash + canonical(row));
  sql.insert('audit_log', { ...row, hash });
  return row.id;
}

export function auditReq(req: Request, action: string, entity?: string, entityId?: string, extra: { patientId?: string | null; meta?: unknown } = {}) {
  const c = req.ctx;
  const base = { ip: req.ip ?? null, action, entity, entityId, patientId: extra.patientId, meta: extra.meta };
  if (!c) return audit({ ...base, tenantId: null, actorType: 'anonymous' });
  if (c.kind === 'staff') return audit({ ...base, tenantId: c.tenantId, actorType: 'staff', actorId: c.userId, actorName: c.name });
  if (c.kind === 'patient') return audit({ ...base, tenantId: c.tenantId, actorType: 'patient', actorId: c.patientId, patientId: c.patientId });
  if (c.kind === 'apikey') return audit({ ...base, tenantId: c.tenantId, actorType: 'api_key', actorId: c.keyId });
  return audit({ ...base, tenantId: null, actorType: 'platform', actorId: c.userId, actorName: c.name });
}

/** Recomputes the chain; returns the first broken entry, if any. */
export function verifyChain(tenantId: string | null): { ok: boolean; checked: number; brokenAt?: string } {
  const rows = tenantId
    ? sql.all('SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY seq', tenantId)
    : sql.all('SELECT * FROM audit_log WHERE tenant_id IS NULL ORDER BY seq');
  let prev = 'genesis';
  for (const r of rows) {
    const { seq: _s, hash, ...rest } = r;
    if (rest.prev_hash !== prev || sha256(rest.prev_hash + canonical(rest)) !== hash) return { ok: false, checked: rows.length, brokenAt: r.id };
    prev = hash;
  }
  return { ok: true, checked: rows.length };
}
