import type { NextFunction, Request, Response } from 'express';
import { sql, j } from '../db/db.js';
import { HttpError, forbidden } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { can, type Permission, type Role } from './rbac.js';
import { sha256, verifyJwt } from './crypto.js';

export interface StaffCtx { kind: 'staff'; userId: string; tenantId: string; role: Role; branchIds: string[]; name: string }
export interface PatientCtx { kind: 'patient'; patientId: string; tenantId: string; deviceId: string }
export interface ApiKeyCtx { kind: 'apikey'; keyId: string; tenantId: string; scopes: string[] }
export interface PlatformCtx { kind: 'platform'; userId: string; name: string }
export type Ctx = StaffCtx | PatientCtx | ApiKeyCtx | PlatformCtx;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { ctx?: Ctx } }
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  // Image <img> tags cannot send headers; allow a short-lived token query param for GET only.
  if (req.method === 'GET' && typeof req.query.token === 'string') return req.query.token;
  return null;
}

/** Resolves any credential type into req.ctx. Never trusts tenant ids from the request body. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return next();
  if (token.startsWith('omk_')) {
    const key = sql.get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', sha256(token));
    if (key) {
      sql.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', nowIso(), key.id);
      req.ctx = { kind: 'apikey', keyId: key.id, tenantId: key.tenant_id, scopes: j.parse(key.scopes_json, []) };
    }
    return next();
  }
  if (token.startsWith('omp_')) {
    const dev = sql.get('SELECT d.*, p.status AS pstatus FROM patient_devices d JOIN patients p ON p.id = d.patient_id WHERE d.token_hash = ? AND d.revoked_at IS NULL', sha256(token));
    if (dev && dev.pstatus !== 'archived') req.ctx = { kind: 'patient', patientId: dev.patient_id, tenantId: dev.tenant_id, deviceId: dev.id };
    return next();
  }
  const p = verifyJwt<{ sub: string; tid: string | null; role: Role; bids: string[]; name: string }>(token);
  if (p) {
    if (p.role === 'platform_admin' && !p.tid) req.ctx = { kind: 'platform', userId: p.sub, name: p.name };
    else if (p.tid) req.ctx = { kind: 'staff', userId: p.sub, tenantId: p.tid, role: p.role, branchIds: p.bids ?? [], name: p.name };
  }
  next();
}

export function staff(req: Request): StaffCtx {
  if (req.ctx?.kind !== 'staff') throw new HttpError(401, 'Sign in required', 'unauthenticated');
  return req.ctx;
}
export function requireStaff(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const c = staff(req);
    for (const p of perms) if (!can(c.role, p)) return next(forbidden());
    next();
  };
}
export function patient(req: Request): PatientCtx {
  if (req.ctx?.kind !== 'patient') throw new HttpError(401, 'Patient session required', 'unauthenticated');
  return req.ctx;
}
export function platform(req: Request): PlatformCtx {
  if (req.ctx?.kind !== 'platform') throw new HttpError(401, 'Platform admin session required', 'unauthenticated');
  return req.ctx;
}
export function apiKey(req: Request, scope: string): ApiKeyCtx {
  if (req.ctx?.kind !== 'apikey') throw new HttpError(401, 'API key required', 'unauthenticated');
  if (!req.ctx.scopes.includes(scope)) throw forbidden(`API key lacks scope ${scope}`);
  return req.ctx;
}

/** Tenant id for staff or API key callers (used by routes shared between both). */
export function tenantOf(req: Request): string {
  const c = req.ctx;
  if (c && (c.kind === 'staff' || c.kind === 'apikey' || c.kind === 'patient')) return c.tenantId;
  throw new HttpError(401, 'Sign in required', 'unauthenticated');
}

/** Branch-scoped patient access check for staff. Throws 404 (never 403) to avoid leaking existence. */
export function assertPatientAccess(c: StaffCtx, patientId: string) {
  const p = sql.get('SELECT id, branch_id FROM patients WHERE id = ? AND tenant_id = ?', patientId, c.tenantId);
  if (!p) throw new HttpError(404, 'Patient not found', 'not_found');
  if (c.role !== 'clinic_admin' && c.branchIds.length && !c.branchIds.includes(p.branch_id)) throw new HttpError(404, 'Patient not found', 'not_found');
  return p;
}

export function branchFilter(c: StaffCtx, alias = 'p'): { clause: string; params: string[] } {
  if (c.role === 'clinic_admin' || !c.branchIds.length) return { clause: '', params: [] };
  return { clause: ` AND ${alias}.branch_id IN (${c.branchIds.map(() => '?').join(',')})`, params: c.branchIds };
}
