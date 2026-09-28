import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// ── Passwords (scrypt) ────────────────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const expected = Buffer.from(h, 'base64');
  const actual = scryptSync(password, Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

// ── AES-256-GCM envelope encryption ───────────────────────────────────────────
// A platform master key wraps one data key per tenant. Tenant data (images, AI keys,
// webhook secrets) is encrypted with the tenant's data key.
const masterKey = () => {
  const k = Buffer.from(config.masterKey, 'base64');
  if (k.length !== 32) throw new Error('OMA_MASTER_KEY must be 32 bytes (base64)');
  return k;
};

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]); // v1 | iv(12) | tag(16) | ct
}
export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob[0] !== 1) throw new Error('Unknown ciphertext version');
  const iv = blob.subarray(1, 13), tag = blob.subarray(13, 29), ct = blob.subarray(29);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export const newWrappedDataKey = () => encrypt(randomBytes(32), masterKey()).toString('base64');
const keyCache = new Map<string, Buffer>();
export function unwrapDataKey(wrapped: string): Buffer {
  let k = keyCache.get(wrapped);
  if (!k) { k = decrypt(Buffer.from(wrapped, 'base64'), masterKey()); keyCache.set(wrapped, k); }
  return k;
}
export const encryptString = (s: string, key: Buffer) => encrypt(Buffer.from(s, 'utf8'), key).toString('base64');
export const decryptString = (s: string, key: Buffer) => decrypt(Buffer.from(s, 'base64'), key).toString('utf8');
export const encryptWithMaster = (s: string) => encryptString(s, masterKey());
export const decryptWithMaster = (s: string) => decryptString(s, masterKey());

// ── JWT (HS256) ───────────────────────────────────────────────────────────────
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export function signJwt(payload: Record<string, unknown>, ttlSeconds: number): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
export function verifyJwt<T = Record<string, any>>(token: string): T | null {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload as T;
}

// ── Webhook signatures ────────────────────────────────────────────────────────
export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}
