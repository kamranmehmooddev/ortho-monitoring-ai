import { sql, j } from '../db/db.js';
import { addDays, today } from '../lib/time.js';
import { deleteBlob } from './storage.js';
import { audit } from './audit.js';

export interface RetentionPolicy { imagesDays: number; messagesDays: number; purgeAfterTreatmentDays: number; auditYears: number }
export const DEFAULT_RETENTION: RetentionPolicy = { imagesDays: 3650, messagesDays: 3650, purgeAfterTreatmentDays: 2555, auditYears: 7 };

export function retentionOf(tenantId: string): RetentionPolicy {
  const t = sql.get('SELECT settings_json FROM tenants WHERE id = ?', tenantId);
  const r = { ...DEFAULT_RETENTION, ...j.parse<{ retention?: Partial<RetentionPolicy> }>(t?.settings_json, {}).retention };
  r.auditYears = Math.max(6, r.auditYears); // audit history is never kept for less than 6 years
  return r;
}

/** Nightly purge job: removes expired images and messages and records a tombstone in the audit log. */
export function runRetention(tenantId: string) {
  const r = retentionOf(tenantId);
  const imgCut = addDays(today(), -r.imagesDays);
  const imgs = sql.all("SELECT id, storage_key FROM images WHERE tenant_id = ? AND created_at < ? AND kind != 'reference'", tenantId, imgCut);
  for (const i of imgs) { deleteBlob(tenantId, i.storage_key); sql.run('DELETE FROM annotations WHERE image_id = ? AND tenant_id = ?', i.id, tenantId); sql.run('DELETE FROM images WHERE id = ? AND tenant_id = ?', i.id, tenantId); }
  const msgs = sql.run('DELETE FROM messages WHERE tenant_id = ? AND created_at < ?', tenantId, addDays(today(), -r.messagesDays));
  if (imgs.length || Number(msgs.changes)) audit({ tenantId, actorType: 'system', action: 'retention.purge', meta: { images: imgs.length, messages: Number(msgs.changes), policy: r } });
  return { images: imgs.length, messages: Number(msgs.changes) };
}
