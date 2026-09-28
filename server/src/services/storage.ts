import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { sql } from '../db/db.js';
import { decrypt, encrypt, unwrapDataKey } from '../security/crypto.js';

/** Encrypted blob storage. Files are AES-256-GCM encrypted with the tenant data key (S3/GCS adapter in production). */
const blobDir = () => path.join(config.dataDir, 'blobs');

export function tenantKey(tenantId: string): Buffer {
  const t = sql.get<{ data_key_wrapped: string }>('SELECT data_key_wrapped FROM tenants WHERE id = ?', tenantId);
  if (!t) throw new Error('Unknown tenant');
  return unwrapDataKey(t.data_key_wrapped);
}

export function putBlob(tenantId: string, key: string, data: Buffer) {
  const file = path.join(blobDir(), tenantId, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encrypt(data, tenantKey(tenantId)));
}

export function getBlob(tenantId: string, key: string): Buffer {
  const file = path.join(blobDir(), tenantId, key);
  if (!file.startsWith(path.join(blobDir(), tenantId))) throw new Error('Invalid key');
  return decrypt(fs.readFileSync(file), tenantKey(tenantId));
}

export function deleteBlob(tenantId: string, key: string) {
  fs.rmSync(path.join(blobDir(), tenantId, key), { force: true });
}
