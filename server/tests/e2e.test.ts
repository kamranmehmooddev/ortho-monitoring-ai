import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oma-e2e-'));
process.env.OMA_DATA_DIR = dir;
process.env.OMA_DB_FILE = path.join(dir, 'e2e.sqlite');

const { openDb, sql, j } = await import('../src/db/db.js');
const crypto = await import('../src/security/crypto.js');
const { createApp } = await import('../src/app.js');
const { newId } = await import('../src/lib/ids.js');
const { nowIso, addDays, today } = await import('../src/lib/time.js');
const { seedTenantDefaults } = await import('../src/db/defaults.js');

const asset = (n: string) => fs.readFileSync(path.join(__dirname, '..', 'seed-assets', `${n}.jpg`));
let base = '';
let staffTok = '';
let patientId = '';

beforeAll(async () => {
  openDb();
  sql.insert('subscription_plans', { id: 'p', name: 'P', price_month_usd: 1, limits_json: '{}', features_json: '{}' });
  const tid = newId('ten');
  sql.insert('tenants', { id: tid, name: 'E2E Clinic', slug: 'e2e-clinic', status: 'active', plan_id: 'p', data_key_wrapped: crypto.newWrappedDataKey(), created_at: nowIso() });
  const br = newId('br'); sql.insert('branches', { id: br, tenant_id: tid, name: 'Main', chairs: 2 });
  const doc = newId('usr');
  sql.insert('users', { id: doc, tenant_id: tid, email: 'doc@e2e.test', name: 'Dr E2E', password_hash: crypto.hashPassword('pw-123456'), role: 'orthodontist', created_at: nowIso() });
  for (let wd = 0; wd < 7; wd++) sql.insert('availability', { id: newId('avl'), tenant_id: tid, doctor_id: doc, branch_id: br, weekday: wd, start_time: '09:00', end_time: '17:00' });
  const [proto] = seedTenantDefaults(tid);
  const server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  staffTok = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'doc@e2e.test', password: 'pw-123456' }) })).json()).token;
  const p = await staff('/patients', { firstName: 'Ada', lastName: 'Test', branchId: br, doctorId: doc, protocolId: proto, consent: { photos: true, ai_processing: true, messaging: true, research: true } });
  patientId = p.id;
  await staff(`/patients/${patientId}/plan`, { totalUpper: 20, totalLower: 20, stageDays: 14, startDate: addDays(today(), -(14 * 4 + 14)), currentStage: 5,
    attachments: [{ tooth: 13, type: 'optimized' }], ipr: [], visits: [], doctorInstructions: 'Review every 6 stages.' }, 'PUT');
});

async function staff(p: string, body?: unknown, method?: string) {
  const r = await fetch(`${base}${p}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${staffTok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json(); if (!r.ok) throw new Error(`${p}: ${JSON.stringify(d)}`); return d;
}

describe('end-to-end: guided check-in → quality gate → review → decision → patient feedback', () => {
  let ptok = '';
  const pat = async (p: string, init: RequestInit = {}) => fetch(`${base}/patient${p}`, { ...init, headers: { authorization: `Bearer ${ptok}`, ...(init.headers ?? {}) } });

  it('activates the patient app with a one-time code', async () => {
    const inv = await staff(`/patients/${patientId}/invite`, {});
    const act = await (await fetch(`${base}/patient/activate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinicCode: inv.clinicCode, activationCode: inv.activationCode }) })).json();
    ptok = act.token;
    const home = await (await pat('/home')).json();
    expect(home.action.kind).toBe('checkin');
    expect(home.requiredViews.length).toBe(5);
  });

  it('rejects a dark photo and asks for a specific retake, then accepts the retake', async () => {
    const created = await (await pat('/checkins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientUuid: randomUUID(), reportedAligner: 5, wear: '22+', fit: 'good' }) })).json();
    const upload = async (view: string, name: string, withAligner: boolean) => {
      const fd = new FormData();
      fd.set('image', new Blob([asset(name)], { type: 'image/jpeg' }), `${view}.jpg`); fd.set('view', view); fd.set('withAligner', String(withAligner));
      return (await pat(`/checkins/${created.id}/images`, { method: 'POST', body: fd })).json();
    };
    expect((await upload('front', 'front_dark_a', true)).qualityStatus).toBe('unusable');
    await upload('left', 'left_aligner_a', true); await upload('right', 'right_aligner_a', true);
    await upload('upper', 'upper_noaligner_a', false); await upload('lower', 'lower_noaligner_a', false);
    const sub = await (await pat(`/checkins/${created.id}/submit`, { method: 'POST' })).json();
    expect(sub.status).toBe('retake_requested');
    expect(sub.views).toEqual(['front']);
    const home = await (await pat('/home')).json();
    expect(home.action.kind).toBe('retake');
    expect(home.action.views).toContain('front');
    const msgs = await (await pat('/messages')).json();
    expect(msgs.at(-1).body).toMatch(/Front bite: .*window/);

    // Retake replaces the unusable image and the check-in reaches the review queue.
    expect((await upload('front', 'front_aligner_a', true)).qualityStatus).toBe('usable');
    const sub2 = await (await pat(`/checkins/${created.id}/submit`, { method: 'POST' })).json();
    expect(sub2.status).toBe('awaiting_review');
    const q = await staff('/review-queue');
    expect(q.items.map((i: any) => i.checkinId)).toContain(created.id);

    const bundle = await staff(`/checkins/${created.id}`);
    expect(bundle.images).toHaveLength(5);
    expect(bundle.gonogo.recommendation).toBe('go');            // all checks pass on the rules engine
    expect(bundle.gonogo.confidence).toBe('low');               // but no AI provider → never high confidence
    expect(bundle.checkin.aiStatus.status).toBe('no_provider'); // honest status, no placeholder findings
    expect(bundle.findings).toHaveLength(0);

    // Clinician decides Go → stage advances, patient sees feedback and a "switch" action.
    const d = await staff(`/checkins/${created.id}/decision`, { type: 'go', message: 'Lovely tracking.' });
    expect(d.stageTo).toBe(6);
    const home2 = await (await pat('/home')).json();
    expect(home2.action.kind).toBe('switch');
    expect(home2.stage.current).toBe(6);
    expect(home2.checkins[0].status).toBe('reviewed');
    expect(home2.checkins[0].feedback).toMatch(/Lovely tracking/);
  });

  it('triages an urgent report without booking an appointment', async () => {
    const fd = new FormData();
    fd.set('clientUuid', randomUUID()); fd.set('category', 'other'); fd.set('painLevel', '3'); fd.set('details', 'I think I swallowed a small piece of the attachment');
    const r = await (await pat('/issues', { method: 'POST', body: fd })).json();
    expect(r.urgency).toBe('P1');
    expect(r.emergency).toBe(true);
    const triage = await staff('/triage');
    expect(triage[0].urgency).toBe('P1');
    const appts = await staff(`/appointments?from=${addDays(today(), -1)}&to=${addDays(today(), 60)}`);
    expect(appts.filter((a: any) => a.patientId === patientId)).toHaveLength(0);
  });

  it('writes a verifiable audit trail for the whole flow', async () => {
    const v = await staff('/audit/verify').catch(() => null);
    // orthodontist role has audit.view
    expect(v?.ok).toBe(true);
    const actions = sql.all('SELECT action FROM audit_log').map((r) => r.action);
    for (const a of ['patient.create', 'patient.activate', 'checkin.submit', 'checkin.view', 'decision.go', 'issue.report']) expect(actions).toContain(a);
    void j;
  });
});
