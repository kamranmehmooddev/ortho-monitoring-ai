import { Router } from 'express';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, HttpError } from '../lib/http.js';
import { nowIso } from '../lib/time.js';
import { signJwt, verifyPassword } from '../security/crypto.js';
import { ROLE_LABELS, ROLE_PERMISSIONS, type Role } from '../security/rbac.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';

export const authRouter = Router();

const attempts = new Map<string, { n: number; at: number }>();
function rateLimit(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && now - a.at < 60_000 && a.n >= 10) throw new HttpError(429, 'Too many attempts. Try again in a minute.', 'rate_limited');
  attempts.set(key, a && now - a.at < 60_000 ? { n: a.n + 1, at: a.at } : { n: 1, at: now });
}

authRouter.post('/login', h((req) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  rateLimit(`${req.ip}:${body.email}`);
  const u = sql.get('SELECT * FROM users WHERE email = ?', body.email.toLowerCase());
  const fail = () => { throw new HttpError(401, 'Email or password is incorrect', 'invalid_credentials'); };
  if (!u || u.status !== 'active') return fail();
  if (u.locked_until && u.locked_until > nowIso()) throw new HttpError(423, 'Account temporarily locked after repeated failed sign-ins', 'locked');
  if (!verifyPassword(body.password, u.password_hash)) {
    const n = u.failed_logins + 1;
    sql.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', n, n >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null, u.id);
    audit({ tenantId: u.tenant_id, actorType: 'staff', actorId: u.id, actorName: u.name, action: 'auth.login_failed', ip: req.ip });
    return fail();
  }
  if (u.tenant_id) {
    const t = sql.get('SELECT status FROM tenants WHERE id = ?', u.tenant_id);
    if (t?.status !== 'active' && t?.status !== 'trial') throw new HttpError(403, 'This clinic account is suspended', 'tenant_suspended');
  }
  sql.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), u.id);
  const token = signJwt({ sub: u.id, tid: u.tenant_id, role: u.role, bids: j.parse(u.branch_ids_json, []), name: u.name }, config.sessionHours * 3600);
  audit({ tenantId: u.tenant_id, actorType: u.role === 'platform_admin' ? 'platform' : 'staff', actorId: u.id, actorName: u.name, action: 'auth.login', ip: req.ip });
  return { token, user: me(u.id) };
}));

authRouter.get('/me', h((req) => {
  const c = req.ctx;
  if (!c || (c.kind !== 'staff' && c.kind !== 'platform')) throw new HttpError(401, 'Sign in required', 'unauthenticated');
  return me(c.userId);
}));

function me(userId: string) {
  const u = sql.get('SELECT * FROM users WHERE id = ?', userId)!;
  const t = u.tenant_id ? sql.get('SELECT t.id, t.name, t.slug, t.branding_json, t.plan_id, t.onboarding_json FROM tenants t WHERE t.id = ?', u.tenant_id) : null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role as Role, roleLabel: ROLE_LABELS[u.role as Role], title: u.title,
    permissions: ROLE_PERMISSIONS[u.role as Role], branchIds: j.parse(u.branch_ids_json, []),
    tenant: t ? { id: t.id, name: t.name, slug: t.slug, planId: t.plan_id, branding: j.parse(t.branding_json, {}), onboarding: j.parse(t.onboarding_json, {}) } : null,
  };
}
