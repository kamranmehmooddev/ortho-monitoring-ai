import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-test-'));
process.env.OMA_DATA_DIR = dir;
process.env.OMA_DB_FILE = path.join(dir, 'test.sqlite');

const { openDb, sql, j } = await import('../src/db/db.js');
const crypto = await import('../src/security/crypto.js');
const { audit, verifyChain } = await import('../src/services/audit.js');
const { createApp } = await import('../src/app.js');
const { newId } = await import('../src/lib/ids.js');
const { nowIso } = await import('../src/lib/time.js');
const { seedTenantDefaults } = await import('../src/db/defaults.js');

let base = '';
const ids: Record<string, string> = {};

beforeAll(async () => {
  openDb();
  sql.insert('subscription_plans', { id: 'p', name: 'P', price_month_usd: 1, limits_json: '{}', features_json: '{}' });
  for (const t of ['A', 'B']) {
    const tid = newId('ten'); ids[`t${t}`] = tid;
    sql.insert('tenants', { id: tid, name: `Clinic ${t}`, slug: `clinic-${t.toLowerCase()}`, status: 'active', plan_id: 'p', data_key_wrapped: crypto.newWrappedDataKey(), created_at: nowIso() });
    const br = newId('br'); sql.insert('branches', { id: br, tenant_id: tid, name: 'Main', chairs: 2 });
    const uid = newId('usr'); ids[`u${t}`] = uid;
    sql.insert('users', { id: uid, tenant_id: tid, email: `doc${t.toLowerCase()}@x.test`, name: `Doc ${t}`, password_hash: crypto.hashPassword('pw-123456'), role: 'orthodontist', created_at: nowIso() });
    const [proto] = seedTenantDefaults(tid);
    const pid = newId('pat'); ids[`p${t}`] = pid;
    sql.insert('patients', { id: pid, tenant_id: tid, branch_id: br, doctor_id: uid, first_name: 'Pat', last_name: t, protocol_id: proto, status: 'active', consent_json: j.str({ photos: true, ai_processing: true, messaging: true }), created_at: nowIso() });
  }
  sql.insert('users', { id: newId('usr'), tenant_id: ids.tA, email: 'desk@x.test', name: 'Desk', password_hash: crypto.hashPassword('pw-123456'), role: 'front_desk', created_at: nowIso() });
  const server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

const login = async (email: string) => (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'pw-123456' }) })).json()).token as string;
const get = (p: string, tok: string) => fetch(`${base}${p}`, { headers: { authorization: `Bearer ${tok}` } });

describe('crypto', () => {
  it('round-trips AES-GCM and detects tampering', () => {
    const key = Buffer.alloc(32, 7);
    const ct = crypto.encrypt(Buffer.from('secret'), key);
    expect(crypto.decrypt(ct, key).toString()).toBe('secret');
    ct[ct.length - 1] ^= 1;
    expect(() => crypto.decrypt(ct, key)).toThrow();
  });
  it('verifies passwords and rejects expired/forged JWTs', () => {
    const h = crypto.hashPassword('abc');
    expect(crypto.verifyPassword('abc', h)).toBe(true);
    expect(crypto.verifyPassword('abd', h)).toBe(false);
    const t = crypto.signJwt({ sub: 'x' }, 60);
    expect(crypto.verifyJwt(t)?.sub).toBe('x');
    expect(crypto.verifyJwt(t.slice(0, -2) + 'aa')).toBeNull();
    expect(crypto.verifyJwt(crypto.signJwt({ sub: 'x' }, -10))).toBeNull();
  });
});

describe('audit chain', () => {
  it('detects modification of any entry', () => {
    audit({ tenantId: ids.tA, actorType: 'test', action: 'one' });
    audit({ tenantId: ids.tA, actorType: 'test', action: 'two' });
    expect(verifyChain(ids.tA).ok).toBe(true);
    sql.run("UPDATE audit_log SET action = 'tampered' WHERE action = 'one'");
    expect(verifyChain(ids.tA).ok).toBe(false);
  });
});

describe('tenant isolation & RBAC over HTTP', () => {
  it('a clinic cannot read another clinic\'s patient (404, not 403)', async () => {
    const tokA = await login('doca@x.test');
    expect((await get(`/patients/${ids.pA}`, tokA)).status).toBe(200);
    expect((await get(`/patients/${ids.pB}`, tokA)).status).toBe(404);
    const list = await (await get('/patients', tokA)).json();
    expect(list.map((p: { id: string }) => p.id)).toEqual([ids.pA]);
  });
  it('front desk cannot make clinical decisions or manage AI keys', async () => {
    const tok = await login('desk@x.test');
    const r = await fetch(`${base}/checkins/whatever/decision`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: '{"type":"go"}' });
    expect(r.status).toBe(403);
    expect((await get('/ai-providers', tok)).status).toBe(403);
  });
  it('AI keys are encrypted at rest and never returned', async () => {
    sql.run("UPDATE users SET role = 'clinic_admin' WHERE email = 'doca@x.test'");
    const tok = await login('doca@x.test');
    const res = await fetch(`${base}/ai-providers`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', label: 'Main', model: 'claude-opus-5', apiKey: 'sk-ant-test-1234567890abcd' }) });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain('sk-ant-test');
    expect(JSON.parse(body).keyLast4).toBe('abcd');
    const row = sql.get("SELECT key_ciphertext FROM ai_provider_configs WHERE tenant_id = ?", ids.tA);
    expect(row.key_ciphertext).not.toContain('sk-ant');
    const other = await login('docb@x.test');
    expect((await (await get('/ai-providers', other)).text())).toBe('{"error":{"code":"forbidden","message":"You do not have permission to do this"}}');
  });
  it('patient tokens are bound to a single patient', async () => {
    const tok = await login('doca@x.test');
    const inv = await (await fetch(`${base}/patients/${ids.pA}/invite`, { method: 'POST', headers: { authorization: `Bearer ${tok}` } })).json();
    const act = await (await fetch(`${base}/patient/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinicCode: inv.clinicCode, activationCode: inv.activationCode }) })).json();
    expect(act.token).toMatch(/^omp_/);
    expect((await get('/patient/home', act.token)).status).toBe(200);
    expect((await get(`/patients/${ids.pA}`, act.token)).status).toBe(401); // staff endpoints refuse patient tokens
    // codes are single-use
    const again = await fetch(`${base}/patient/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinicCode: inv.clinicCode, activationCode: inv.activationCode }) });
    expect(again.status).toBe(401);
  });
  it('check-in creation is idempotent by client UUID', async () => {
    const tok = await login('doca@x.test');
    const inv = await (await fetch(`${base}/patients/${ids.pA}/invite`, { method: 'POST', headers: { authorization: `Bearer ${tok}` } })).json();
    const act = await (await fetch(`${base}/patient/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinicCode: inv.clinicCode, activationCode: inv.activationCode }) })).json();
    const body = JSON.stringify({ clientUuid: '7b0b7f7e-1c1e-4a8e-9a53-4cfe1f1d2b11', wear: '22+', fit: 'good' });
    const h = { authorization: `Bearer ${act.token}`, 'content-type': 'application/json' };
    const a = await (await fetch(`${base}/patient/checkins`, { method: 'POST', headers: h, body })).json();
    const b = await (await fetch(`${base}/patient/checkins`, { method: 'POST', headers: h, body })).json();
    expect(b.id).toBe(a.id);
    expect(b.idempotent).toBe(true);
  });
});
