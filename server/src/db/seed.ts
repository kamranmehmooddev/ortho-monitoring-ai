/**
 * Seeds realistic demo data. All dates are relative to "today" so the demo always looks current.
 * Images are SYNTHETIC illustrations from seed-assets/ (watermarked "Synthetic demo image").
 * Seeded observations are stored with source = 'seed_demo' and are labelled "Demo data" in the UI:
 * they are NOT model output. Real observations appear only after an AI provider key is configured.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { closeDb, openDb, sql, j } from './db.js';
import { newId } from '../lib/ids.js';
import { addDays, today } from '../lib/time.js';
import { encryptString, hashPassword, newWrappedDataKey, randomToken, sha256 } from '../security/crypto.js';
import { tenantKey } from '../services/storage.js';
import { storeImage } from '../services/images.js';
import { seedTenantDefaults } from './defaults.js';
import { generateStages } from '../services/plan.js';
import { parseInstructions } from '../services/scheduling/instructionParser.js';
import { triage, type IssueCategory } from '../services/scheduling/triage.js';
import { computeCheckinSignals, processSubmission, refreshRecommendation } from '../services/review.js';
import { audit } from '../services/audit.js';

const PASSWORD = process.env.OMA_DEMO_PASSWORD ?? 'Demo!2026';

// Fresh database
fs.rmSync(config.dbFile, { force: true });
fs.rmSync(`${config.dbFile}-wal`, { force: true });
fs.rmSync(`${config.dbFile}-shm`, { force: true });
fs.rmSync(path.join(config.dataDir, 'blobs'), { recursive: true, force: true });
openDb();

const at = (daysAgo: number, hour = 10, min = 0) => {
  const d = new Date(`${addDays(today(), -daysAgo)}T00:00:00Z`);
  d.setUTCHours(hour, min);
  return d.toISOString();
};
const asset = (name: string) => fs.readFileSync(path.join(config.seedAssets, `${name}.jpg`));

// ── Plans ────────────────────────────────────────────────────────────────────
const PLANS = [
  { id: 'plan_starter', name: 'Starter', price: 249, limits: { activePatients: 60, branches: 1, seats: 5 }, features: { platformAi: false, byoAi: true, webhooks: false, api: false, branding: false, evaluation: false } },
  { id: 'plan_practice', name: 'Practice', price: 599, limits: { activePatients: 250, branches: 3, seats: 20 }, features: { platformAi: true, byoAi: true, webhooks: true, api: true, branding: true, evaluation: false, includedAiCreditUsd: 40 } },
  { id: 'plan_group', name: 'Group', price: 1490, limits: { activePatients: 1000, branches: 15, seats: 100 }, features: { platformAi: true, byoAi: true, webhooks: true, api: true, branding: true, evaluation: true, sso: true, customRetention: true } },
  { id: 'plan_enterprise', name: 'Enterprise', price: 0, limits: {}, features: { platformAi: true, byoAi: true, webhooks: true, api: true, branding: true, evaluation: true, sso: true, customRetention: true, dedicatedRegion: true } },
];
for (const p of PLANS) sql.insert('subscription_plans', { id: p.id, name: p.name, price_month_usd: p.price, limits_json: j.str(p.limits), features_json: j.str(p.features) });

// ── Platform admin ───────────────────────────────────────────────────────────
sql.insert('users', { id: newId('usr'), tenant_id: null, email: 'admin@orthomonitoring.ai', name: 'Riya Kapoor', password_hash: hashPassword(PASSWORD), role: 'platform_admin', title: 'Platform operations', branch_ids_json: '[]', created_at: at(200) });

// ── Tenant A: Lumen Orthodontics ─────────────────────────────────────────────
const T = newId('ten');
sql.insert('tenants', { id: T, name: 'Lumen Orthodontics', slug: 'lumen-ortho', status: 'active', plan_id: 'plan_group',
  branding_json: j.str({ accent: '#0F6E6A', displayName: 'Lumen Orthodontics', logoText: 'L', patientWelcome: 'Your smile, checked in minutes.' }),
  settings_json: j.str({ scheduling: { visitEveryStages: 6 } }), data_key_wrapped: newWrappedDataKey(),
  onboarding_json: j.str({ profile: true, branch: true, team: true, protocol: true, firstPatient: true }), created_at: at(180) });
const BR1 = newId('br'), BR2 = newId('br');
sql.insert('branches', { id: BR1, tenant_id: T, name: 'Harbour Street', timezone: 'Europe/London', address: '14 Harbour Street, Bristol BS1 4QA', chairs: 4, hours_json: '{}' });
sql.insert('branches', { id: BR2, tenant_id: T, name: 'Northgate', timezone: 'Europe/London', address: '2 Northgate Parade, Bath BA1 5AL', chairs: 2, hours_json: '{}' });

const mkUser = (email: string, name: string, role: string, title: string, branches: string[] = []) => {
  const id = newId('usr');
  sql.insert('users', { id, tenant_id: T, email, name, password_hash: hashPassword(PASSWORD), role, title, branch_ids_json: j.str(branches), last_login_at: at(1, 8), created_at: at(170) });
  return id;
};
const OKAFOR = mkUser('amara.okafor@lumen-ortho.demo', 'Dr. Amara Okafor', 'clinic_admin', 'Orthodontist · Clinical lead');
const REYES = mkUser('daniel.reyes@lumen-ortho.demo', 'Dr. Daniel Reyes', 'orthodontist', 'Orthodontist', [BR2]);
const LEO = mkUser('leo.martins@lumen-ortho.demo', 'Leo Martins', 'treatment_coordinator', 'Treatment coordinator');
mkUser('sofia.bianchi@lumen-ortho.demo', 'Sofia Bianchi', 'front_desk', 'Front desk');

const protocolIds = seedTenantDefaults(T, OKAFOR);
const [P_STD, P_ACC, P_IPR, P_FIXED, P_RET] = protocolIds;

for (let wd = 1; wd <= 4; wd++) sql.insert('availability', { id: newId('avl'), tenant_id: T, doctor_id: OKAFOR, branch_id: BR1, weekday: wd, start_time: '08:30', end_time: '17:00' });
sql.insert('availability', { id: newId('avl'), tenant_id: T, doctor_id: OKAFOR, branch_id: BR2, weekday: 5, start_time: '08:30', end_time: '13:00' });
for (let wd = 2; wd <= 5; wd++) sql.insert('availability', { id: newId('avl'), tenant_id: T, doctor_id: REYES, branch_id: BR2, weekday: wd, start_time: '09:00', end_time: '17:30' });
sql.insert('availability', { id: newId('avl'), tenant_id: T, doctor_id: REYES, branch_id: BR1, weekday: 1, start_time: '09:00', end_time: '17:30' });

// ── Helpers ──────────────────────────────────────────────────────────────────
const ALL5 = ['front', 'left', 'right', 'upper', 'lower'] as const;
const FULL_CONSENT = { photos: true, ai_processing: true, messaging: true, research: true };

interface PatientSpec {
  first: string; last: string; dob: string; mode?: string; protocol: string; branch?: string; doctor?: string; status?: string; hue: number;
  guardian?: unknown; consent?: Record<string, boolean>; email?: string; phone?: string; ref?: string;
  plan?: { system?: string; total: number; lower?: number; stageDays: number; stage: number; daysOn: number; instructions?: string;
    attachments?: { tooth: number; type: string }[]; ipr?: { a: number; b: number; mm: number; stage: number; status?: string }[]; visits?: { stage: number; reason: string; procedures: string[] }[] };
}

function mkPatient(s: PatientSpec) {
  const id = newId('pat');
  sql.insert('patients', { id, tenant_id: T, branch_id: s.branch ?? BR1, doctor_id: s.doctor ?? OKAFOR, first_name: s.first, last_name: s.last, dob: s.dob, mode: s.mode ?? 'aligner',
    email: s.email ?? `${s.first.toLowerCase()}.${s.last.toLowerCase()}@example.com`, phone: s.phone ?? `+44 7700 9${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`,
    guardian_json: s.guardian ? j.str(s.guardian) : null, protocol_id: s.protocol, status: s.status ?? 'active',
    consent_json: j.str({ ...(s.consent ?? FULL_CONSENT), recorded_at: at(120), recorded_by: LEO }), external_ref: s.ref ?? `PMS-${Math.floor(10000 + Math.random() * 89999)}`,
    avatar_hue: s.hue, created_at: at(130) });
  let planId: string | null = null;
  if (s.plan) {
    const p = s.plan;
    planId = newId('pln');
    const start = addDays(today(), -((p.stage - 1) * p.stageDays + p.daysOn));
    sql.insert('treatment_plans', { id: planId, tenant_id: T, patient_id: id, system: p.system ?? 'Clear aligners', total_upper: p.total, total_lower: p.lower ?? p.total, stage_days: p.stageDays,
      start_date: start, current_stage: p.stage, doctor_instructions: p.instructions ?? null, instruction_tags_json: j.str(parseInstructions(p.instructions)), status: 'active', created_at: at(125) });
    for (const st of generateStages(start, p.total, p.stageDays)) {
      sql.insert('plan_stages', { id: newId('stg'), tenant_id: T, plan_id: planId, stage_no: st.stage_no, expected_start: st.expected_start, expected_change: st.expected_change,
        actual_start: st.stage_no <= p.stage ? st.expected_start : null, approved_by: st.stage_no <= p.stage && st.stage_no > 1 ? OKAFOR : null,
        status: st.stage_no < p.stage ? 'completed' : st.stage_no === p.stage ? 'active' : 'upcoming' });
    }
    for (const a of p.attachments ?? []) sql.insert('attachments', { id: newId('att'), tenant_id: T, plan_id: planId, tooth_fdi: a.tooth, type: a.type, surface: 'buccal', placed_stage: 1 });
    for (const i of p.ipr ?? []) sql.insert('ipr_events', { id: newId('ipr'), tenant_id: T, plan_id: planId, tooth_a: i.a, tooth_b: i.b, amount_mm: i.mm, stage_no: i.stage, status: i.status ?? 'planned',
      done_at: i.status === 'done' ? at(40) : null, done_by: i.status === 'done' ? OKAFOR : null });
    for (const v of p.visits ?? []) sql.insert('planned_visits', { id: newId('pv'), tenant_id: T, plan_id: planId, stage_no: v.stage, reason: v.reason, procedures_json: j.str(v.procedures) });
    for (const v of ALL5) storeImage(asset(`baseline_${v}`), { tenantId: T, patientId: id, ownerType: 'reference', ownerId: null, view: v, withAligner: false, kind: 'baseline' });
  }
  return { id, planId };
}

const STD_ATT = [13, 23, 14, 24, 15, 25, 33, 43, 34, 44].map((t) => ({ tooth: t, type: t % 10 === 3 ? 'optimized' : 'rectangular' }));

interface CheckinSpec {
  daysAgo: number; hour?: number; stage: number; images: Partial<Record<(typeof ALL5)[number], string>>; wear?: string; fit?: string; pain?: number; symptoms?: string[]; concerns?: string;
  status?: 'awaiting_review' | 'reviewed' | 'retake_requested'; decision?: { type: 'go' | 'no_go' | 'retake' | 'visit'; hold?: number; message?: string; by?: string; overrode?: boolean; hoursAfter?: number };
  findings?: { category: string; teeth: number[]; view: string; assessment?: string; uncertainty?: string; novelty?: string; evidence: string; status?: string; bbox?: unknown; clinicianCategory?: string }[];
}

function mkCheckin(patientId: string, planId: string | null, c: CheckinSpec) {
  const id = newId('chk');
  const created = at(c.daysAgo, c.hour ?? 19, 12);
  const status = c.status ?? (c.decision ? (c.decision.type === 'retake' ? 'retake_requested' : 'reviewed') : 'awaiting_review');
  sql.insert('checkins', { id, tenant_id: T, patient_id: patientId, plan_id: planId, client_uuid: randomUUID(), stage_no: c.stage, reported_aligner: c.stage, wear_hours_bucket: c.wear ?? '22+',
    fit: c.fit ?? 'good', symptoms_json: j.str(c.symptoms ?? []), pain_level: c.pain ?? 0, concerns: c.concerns ?? null, status, submitted_at: created, created_at: created,
    ai_status: j.str({ status: 'completed', provider: 'seed_demo', model: 'demo-seed', promptVersion: 'n/a', message: 'Demo record: observations below were seeded for demonstration and are not model output.', at: created }) });
  for (const [view, name] of Object.entries(c.images)) {
    const img = storeImage(asset(name!), { tenantId: T, patientId, ownerType: 'checkin', ownerId: id, view, withAligner: !['upper', 'lower'].includes(view) && !name!.includes('noaligner'), capturedAt: created });
    sql.run('UPDATE images SET created_at = ? WHERE id = ?', created, img.id);
  }
  for (const f of c.findings ?? []) {
    const img = sql.get("SELECT id, quality_status FROM images WHERE owner_type = 'checkin' AND owner_id = ? AND view = ?", id, f.view);
    const reviewed = f.status && f.status !== 'open';
    sql.insert('findings', { id: newId('fnd'), tenant_id: T, checkin_id: id, patient_id: patientId, source: 'seed_demo', category: f.category, region_fdi_json: j.str(f.teeth), view: f.view,
      image_id: img?.id ?? null, bbox_json: f.bbox ? j.str(f.bbox) : null, assessment: f.assessment ?? 'possible', novelty: f.novelty ?? 'new', uncertainty: f.uncertainty ?? 'medium',
      confidence: null, rationale: null, evidence: f.evidence, needs_better_image: f.assessment === 'cannot_assess' ? 1 : 0, model_version: 'demo-seed', prompt_version: 'n/a',
      quality_band: img?.quality_status ?? 'unknown', status: f.status ?? 'open', clinician_category: f.clinicianCategory ?? null, reviewed_by: reviewed ? OKAFOR : null,
      reviewed_at: reviewed ? at(c.daysAgo - 1, 9) : null, created_at: created });
  }
  if (c.decision) {
    const d = c.decision;
    const decidedAt = new Date(new Date(created).getTime() + (d.hoursAfter ?? 14) * 3600_000).toISOString();
    const msg = d.message ?? { go: `Great progress! You can switch to aligner ${c.stage + 1} today.`, no_go: `Please stay on aligner ${c.stage} for ${d.hold ?? 4} more days. Use your chewies 3× a day.`, retake: 'Please retake your photos.', visit: 'We would like to see you in clinic. The team will call you to book.' }[d.type];
    sql.insert('decisions', { id: newId('dec'), tenant_id: T, checkin_id: id, patient_id: patientId, type: d.type, stage_from: c.stage, stage_to: d.type === 'go' ? c.stage + 1 : null,
      hold_days: d.type === 'no_go' ? d.hold ?? 4 : null, message: msg, decided_by: d.by ?? OKAFOR, decided_at: decidedAt, overrode_recommendation: d.overrode ? 1 : 0,
      recommendation_json: j.str({ recommendation: d.overrode ? 'no_go' : d.type, confidence: 'medium' }) });
    sql.run('UPDATE checkins SET reviewed_at = ?, reviewed_by = ? WHERE id = ?', decidedAt, d.by ?? OKAFOR, id);
    msgRow(patientId, 'staff', msg, decidedAt, d.by ?? OKAFOR);
  }
  msgRow(patientId, 'system', 'Your check-in was received and is waiting for your orthodontist to review it. Keep wearing your current aligner until you hear back.', new Date(new Date(created).getTime() + 60_000).toISOString(), null, 'checkin_received');
  return id;
}

function msgRow(patientId: string, sender: 'patient' | 'staff' | 'system', body: string, createdAt: string, senderId: string | null = null, rule: string | null = null, read = true) {
  sql.insert('messages', { id: newId('msg'), tenant_id: T, patient_id: patientId, sender_type: sender, sender_id: sender === 'patient' ? patientId : senderId, body, image_ids_json: '[]',
    automated_rule: rule, read_at: read ? createdAt : null, created_at: createdAt });
}

function wear(patientId: string, pattern: number[]) {
  for (let i = 0; i < 21; i++) sql.insert('wear_logs', { id: newId('wr'), tenant_id: T, patient_id: patientId, date: addDays(today(), -i), hours: pattern[i % pattern.length] });
}

function issue(patientId: string, category: IssueCategory, daysAgo: number, hour: number, details: string, pain = 0, photo?: string, status = 'open', extra: { attachmentsOffCount?: number } = {}) {
  const t = triage({ category, painLevel: pain, details, ...extra });
  const id = newId('iss');
  const created = at(daysAgo, hour);
  sql.insert('issue_reports', { id, tenant_id: T, patient_id: patientId, client_uuid: randomUUID(), category, pain_level: pain, details, urgency: t.urgency, urgency_reasons_json: j.str(t.reasons),
    triage_status: status, sla_due_at: new Date(new Date(created).getTime() + t.slaMinutes * 60_000).toISOString(), created_at: created, resolved_at: status === 'resolved' ? at(daysAgo - 1) : null,
    resolution: status === 'resolved' ? 'Called patient; advised to continue. Resolved.' : null });
  if (photo) storeImage(asset(photo), { tenantId: T, patientId, ownerType: 'issue', ownerId: id, kind: 'issue' });
  msgRow(patientId, 'system', `We received your report. ${t.urgency <= 'P2' ? 'Our team has been alerted and will contact you as soon as possible.' : 'The clinic team will review it.'}\n\nWhile you wait: ${t.guidance}`, new Date(new Date(created).getTime() + 30_000).toISOString(), null, 'issue_received');
  return id;
}

function appt(patientId: string, daysFromNow: number, time: string, dur: number, type: string, status = 'booked', doctor = OKAFOR, branch = BR1, chair = 1) {
  sql.insert('appointments', { id: newId('apt'), tenant_id: T, branch_id: branch, patient_id: patientId, doctor_id: doctor, chair, start_at: `${addDays(today(), daysFromNow)}T${time}`,
    duration_min: dur, type, status, created_at: at(Math.max(1, -daysFromNow + 5)) });
}

const img5 = (v: 'a' | 'b' | 'c', over: Partial<Record<(typeof ALL5)[number], string>> = {}) => ({
  front: `front_aligner_${v}`, left: `left_aligner_${v}`, right: `right_aligner_${v}`, upper: `upper_noaligner_${v}`, lower: `lower_noaligner_${v}`, ...over,
});

// ── Patients & scenarios ─────────────────────────────────────────────────────
// 1. Priya: clean, ready to advance (batch-eligible Go)
{
  const { id, planId } = mkPatient({ first: 'Priya', last: 'Shah', dob: '2009-04-12', protocol: P_STD, hue: 18, guardian: { name: 'Nisha Shah', relationship: 'Mother', phone: '+44 7700 900112' },
    plan: { total: 24, stageDays: 14, stage: 8, daysOn: 14, attachments: STD_ATT, instructions: 'Routine review every 6 stages. Check attachments UR3 and UL3 at each visit.' } });
  wear(id, [22.5, 23, 22, 22.5, 21.5, 23, 22]);
  mkCheckin(id, planId, { daysAgo: 28, stage: 6, images: img5('a'), decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 14, stage: 7, images: img5('b'), decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 0, hour: 7, stage: 8, images: img5('c'), concerns: 'All good, no pain this time!' });
  msgRow(id, 'patient', 'Hi! Aligner 8 feels much better than 7 did. Is it okay to use the chewies less now?', at(3, 18), null, null, true);
  msgRow(id, 'staff', 'Great to hear, Priya! Keep using them for a few minutes after each new aligner, that is when they help most.', at(3, 19, 30), LEO);
  appt(id, 12, '15:30', 20, 'progress_review');
}
// 2. Marcus: persistent possible seating gap at 11/21 → tracking assessment
{
  const { id, planId } = mkPatient({ first: 'Marcus', last: 'Chen', dob: '1991-09-03', protocol: P_STD, hue: 210,
    plan: { total: 30, stageDays: 14, stage: 12, daysOn: 15, attachments: STD_ATT, instructions: 'Rescan if tracking poor at upper incisors. Chewies from stage 10.' } });
  wear(id, [21, 20.5, 22, 19.5, 21, 20, 22]);
  mkCheckin(id, planId, { daysAgo: 29, stage: 10, images: img5('a'), decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 14, stage: 11, images: img5('b', { front: 'front_gap_a' }), fit: 'unsure', decision: { type: 'go', overrode: true, message: 'Switch to aligner 12. Use chewies 3× daily focusing on your front teeth.' },
    findings: [{ category: 'tracking_gap', teeth: [11, 21], view: 'front', evidence: 'Visible space between the aligner incisal edge and the incisal edges of 11 and 21.', status: 'confirmed', bbox: { x: 0.38, y: 0.44, w: 0.24, h: 0.1 } }] });
  mkCheckin(id, planId, { daysAgo: 0, hour: 8, stage: 12, images: img5('c', { front: 'front_gap_b' }), fit: 'poor', wear: '20-22', concerns: 'Front of the aligner still feels loose after chewies.',
    findings: [
      { category: 'tracking_gap', teeth: [11, 12, 21], view: 'front', novelty: 'persistent', evidence: 'Space between aligner edge and incisal edges of 11, 21 (and possibly 12) similar to or larger than the previous check-in.', bbox: { x: 0.33, y: 0.44, w: 0.34, h: 0.1 } },
      { category: 'attachment_obscured', teeth: [13], view: 'front', assessment: 'cannot_assess', uncertainty: 'high', evidence: 'Attachment region on 13 affected by aligner reflection.' },
    ] });
  msgRow(id, 'patient', 'The front of aligner 12 is not clicking in fully even with chewies. Should I stay on it longer?', at(0, 8, 20), null, null, false);
}
// 3. Elena: attachment possibly missing on 13 + patient report
{
  const { id, planId } = mkPatient({ first: 'Elena', last: 'Rossi', dob: '1996-02-21', protocol: P_STD, hue: 330,
    plan: { total: 20, stageDays: 14, stage: 5, daysOn: 12, attachments: STD_ATT } });
  wear(id, [22, 22.5, 21.5, 23, 22]);
  mkCheckin(id, planId, { daysAgo: 14, stage: 4, images: img5('a'), decision: { type: 'go' } });
  issue(id, 'attachment_off', 1, 20, 'I think a bump came off my upper right canine while flossing.', 1, undefined, 'open', { attachmentsOffCount: 1 });
  mkCheckin(id, planId, { daysAgo: 1, hour: 20, stage: 5, images: img5('b', { upper: 'upper_attach_missing_a' }),
    findings: [{ category: 'attachment_missing', teeth: [13], view: 'upper', evidence: 'Buccal surface of 13 clearly visible; attachment present on baseline image is not visible here.', bbox: { x: 0.22, y: 0.28, w: 0.14, h: 0.12 } }] });
}
// 4. Jonah: lost aligner (P2 triage)
{
  const { id, planId } = mkPatient({ first: 'Jonah', last: 'Williams', dob: '2007-11-30', protocol: P_STD, hue: 140, guardian: { name: 'Karen Williams', relationship: 'Mother' },
    plan: { total: 22, stageDays: 14, stage: 15, daysOn: 6, attachments: STD_ATT } });
  wear(id, [20, 21, 19, 22, 18, 20]);
  mkCheckin(id, planId, { daysAgo: 7, stage: 14, images: img5('c'), decision: { type: 'go' } });
  issue(id, 'aligner_lost', 0, 9, 'Left my top aligner on a lunch tray at school, it was thrown away.', 0);
}
// 5. Aisha: IPR planned before stage 10 → visit needed before advancing
{
  const { id, planId } = mkPatient({ first: 'Aisha', last: 'Rahman', dob: '1988-06-15', protocol: P_IPR, hue: 265,
    plan: { total: 26, stageDays: 10, stage: 9, daysOn: 10, attachments: STD_ATT, instructions: 'IPR 0.3mm 12/13 and 22/23 at stage 10. Allow extra 10 min for anxious patient.',
      ipr: [{ a: 12, b: 13, mm: 0.3, stage: 10 }, { a: 22, b: 23, mm: 0.3, stage: 10 }, { a: 32, b: 33, mm: 0.2, stage: 4, status: 'done' }],
      visits: [{ stage: 10, reason: 'IPR upper laterals/canines', procedures: ['ipr'] }] } });
  wear(id, [22, 22, 23, 22.5, 21.5]);
  mkCheckin(id, planId, { daysAgo: 10, stage: 8, images: { ...img5('a'), front: 'front_noaligner_a' }, decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 0, hour: 6, stage: 9, images: { ...img5('b'), front: 'front_aligner_b' },
    findings: [{ category: 'ipr_followup', teeth: [12, 13, 22, 23], view: 'front', assessment: 'cannot_assess', uncertainty: 'high', evidence: 'IPR is scheduled before stage 10; interproximal contacts cannot be confirmed from a photograph.' }] });
}
// 6. Tom: dark photo → automatic retake request through the real pipeline
let TOM_CHECKIN = '';
let TOM = '';
{
  const { id, planId } = mkPatient({ first: 'Tom', last: 'Becker', dob: '2001-01-09', protocol: P_STD, hue: 45,
    plan: { total: 18, stageDays: 14, stage: 7, daysOn: 13, attachments: STD_ATT } });
  TOM = id;
  wear(id, [22, 21, 22]);
  mkCheckin(id, planId, { daysAgo: 14, stage: 6, images: img5('a'), decision: { type: 'go' } });
  const cid = newId('chk');
  sql.insert('checkins', { id: cid, tenant_id: T, patient_id: id, plan_id: planId, client_uuid: randomUUID(), stage_no: 7, reported_aligner: 7, wear_hours_bucket: '22+', fit: 'good',
    symptoms_json: '[]', pain_level: 0, status: 'uploading', created_at: at(0, 7, 40) });
  for (const [view, name] of Object.entries(img5('b', { front: 'front_dark_a', left: 'left_blurry_a' })))
    storeImage(asset(name), { tenantId: T, patientId: id, ownerType: 'checkin', ownerId: cid, view, withAligner: !['upper', 'lower'].includes(view), capturedAt: at(0, 7, 40) });
  TOM_CHECKIN = cid;
}
// 7. Hana: overdue check-in
{
  const { id, planId } = mkPatient({ first: 'Hana', last: 'Sato', dob: '1999-08-08', protocol: P_STD, hue: 5, branch: BR2, doctor: REYES,
    plan: { total: 28, stageDays: 14, stage: 10, daysOn: 20, attachments: STD_ATT } });
  wear(id, [16, 18, 15, 17]);
  mkCheckin(id, planId, { daysAgo: 20, stage: 10, images: img5('a'), wear: '16-20', decision: { type: 'no_go', hold: 5, by: REYES, message: 'Please stay on aligner 10 for 5 more days and aim for 22 hours of wear.' } });
}
// 8. Oliver: cracked aligner with photo
{
  const { id, planId } = mkPatient({ first: 'Oliver', last: 'Grant', dob: '2004-05-27', protocol: P_STD, hue: 95,
    plan: { total: 16, stageDays: 14, stage: 11, daysOn: 9, attachments: STD_ATT } });
  wear(id, [21, 22, 22]);
  issue(id, 'aligner_cracked', 0, 11, 'Crack along the upper front of the aligner, edge feels sharp on my lip.', 3, 'front_crack_a');
  mkCheckin(id, planId, { daysAgo: 0, hour: 11, stage: 11, images: img5('a', { front: 'front_crack_a' }), fit: 'unsure', symptoms: ['sharp_edge'],
    findings: [{ category: 'aligner_damage', teeth: [21], view: 'front', evidence: 'Irregular bright line across the aligner over 21 consistent with a possible crack.', bbox: { x: 0.5, y: 0.34, w: 0.13, h: 0.18 } }] });
}
// 9. Lucia: low wear + poor fit → no-go
{
  const { id, planId } = mkPatient({ first: 'Lucia', last: 'Fernandez', dob: '1993-12-02', protocol: P_STD, hue: 300,
    plan: { total: 22, stageDays: 14, stage: 6, daysOn: 14, attachments: STD_ATT } });
  wear(id, [15, 17, 16.5, 14, 18, 16, 17]);
  mkCheckin(id, planId, { daysAgo: 14, stage: 5, images: img5('b'), wear: '20-22', decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 0, hour: 9, stage: 6, images: img5('c', { left: 'left_gap_a' }), wear: '16-20', fit: 'poor', pain: 2, concerns: 'Had a busy week and wore them less. Left side feels loose.',
    findings: [{ category: 'tracking_gap', teeth: [23, 24], view: 'left', uncertainty: 'medium', evidence: 'Possible space between aligner edge and cusp tips of 23 and 24.', bbox: { x: 0.45, y: 0.36, w: 0.2, h: 0.14 } }] });
}
// 10. Samuel: fixed appliance, loose bracket (P2)
{
  const { id } = mkPatient({ first: 'Samuel', last: 'Okoye', dob: '2008-03-19', mode: 'fixed', protocol: P_FIXED, hue: 185, branch: BR2, doctor: REYES, guardian: { name: 'Grace Okoye', relationship: 'Mother' },
    plan: { system: 'Fixed · 0.022 MBT', total: 12, stageDays: 21, stage: 5, daysOn: 12, instructions: 'Class II elastics 1/4" 3.5oz, wear 20 hours a day. See at stage 6 for archwire change.', visits: [{ stage: 6, reason: 'Archwire change 19x25 NiTi', procedures: ['archwire'] }] } });
  issue(id, 'bracket_loose', 0, 8, 'Bracket on lower left tooth is spinning on the wire since last night.', 2);
  appt(id, 9, '10:00', 30, 'progress_review', 'booked', REYES, BR2, 1);
}
// 11. Grace: too early (not yet)
{
  const { id, planId } = mkPatient({ first: 'Grace', last: 'Kim', dob: '2000-10-10', protocol: P_STD, hue: 160,
    plan: { total: 20, stageDays: 14, stage: 3, daysOn: 7, attachments: STD_ATT } });
  wear(id, [22, 22, 23]);
  mkCheckin(id, planId, { daysAgo: 7, stage: 2, images: img5('a'), decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 0, hour: 12, stage: 3, images: img5('b'), concerns: 'Just checking in early because of a sore gum, it is fine now.', pain: 1 });
}
// 12. Noah: long clean history; approved yesterday
{
  const { id, planId } = mkPatient({ first: 'Noah', last: 'Patel', dob: '1985-07-04', protocol: P_ACC, hue: 230,
    plan: { total: 40, stageDays: 7, stage: 19, daysOn: 1, attachments: STD_ATT, instructions: 'Accelerated protocol. Refinement scan at the end.' } });
  wear(id, [22.5, 23, 22.5, 23.5]);
  for (let k = 6; k >= 1; k--) mkCheckin(id, planId, { daysAgo: k * 7 + 1, stage: 19 - k, images: img5((['a', 'b', 'c'] as const)[k % 3]), decision: { type: 'go' } });
  appt(id, -21, '09:00', 20, 'progress_review', 'completed');
}
// 13. Mia: invited, not yet activated
{
  mkPatient({ first: 'Mia', last: 'Johansson', dob: '2010-02-14', protocol: P_STD, hue: 120, status: 'invited', guardian: { name: 'Erik Johansson', relationship: 'Father' },
    plan: { total: 26, stageDays: 14, stage: 1, daysOn: 1, attachments: STD_ATT } });
}
// 14. Ethan: glare on upper (limited) → low-confidence Go
{
  const { id, planId } = mkPatient({ first: 'Ethan', last: 'Brooks', dob: '1998-05-05', protocol: P_STD, hue: 70,
    plan: { total: 24, stageDays: 14, stage: 14, daysOn: 14, attachments: STD_ATT } });
  wear(id, [22, 22.5, 22]);
  mkCheckin(id, planId, { daysAgo: 16, stage: 13, images: img5('c', { left: 'left_blurry_a' }), decision: { type: 'retake', message: 'Please retake the left bite photo. It was blurry.' }, status: 'reviewed' });
  mkCheckin(id, planId, { daysAgo: 14, stage: 13, images: img5('a'), decision: { type: 'go' } });
  mkCheckin(id, planId, { daysAgo: 0, hour: 13, stage: 14, images: img5('b', { upper: 'upper_glare_a' }),
    findings: [{ category: 'attachment_obscured', teeth: [14, 15, 24], view: 'upper', assessment: 'cannot_assess', uncertainty: 'high', evidence: 'Strong glare over the premolar region hides the attachment surfaces.' }] });
}
// 15. Zara: retention monthly
{
  const { id, planId } = mkPatient({ first: 'Zara', last: 'Ahmed', dob: '1990-09-22', mode: 'retention', protocol: P_RET, hue: 280, consent: { photos: true, ai_processing: false, messaging: true, research: false },
    plan: { system: 'Vivera retainers', total: 3, stageDays: 90, stage: 2, daysOn: 40 } });
  mkCheckin(id, planId, { daysAgo: 30, stage: 2, images: { front: 'front_noaligner_b', upper: 'upper_noaligner_c', lower: 'lower_noaligner_c' }, decision: { type: 'go', message: 'Retention looks stable. Keep wearing your retainers every night.' } });
}

// Past reviewed findings (populate evaluation workspace with clearly-labelled demo corrections)
{
  const rows = sql.all("SELECT id FROM checkins WHERE tenant_id = ? AND status = 'reviewed' ORDER BY created_at LIMIT 6", T);
  const cats: [string, string, string?][] = [['tracking_gap', 'dismissed'], ['attachment_missing', 'confirmed'], ['tracking_gap', 'confirmed'], ['attachment_obscured', 'dismissed'], ['aligner_damage', 'corrected', 'attachment_damaged'], ['plaque', 'dismissed']];
  rows.forEach((r, i) => {
    const c = sql.get('SELECT patient_id, created_at FROM checkins WHERE id = ?', r.id)!;
    const [cat, status, corr] = cats[i];
    sql.insert('findings', { id: newId('fnd'), tenant_id: T, checkin_id: r.id, patient_id: c.patient_id, source: 'seed_demo', category: cat, region_fdi_json: j.str([13]), view: 'front', assessment: cat === 'attachment_obscured' ? 'cannot_assess' : 'possible',
      novelty: 'new', uncertainty: ['low', 'medium', 'high'][i % 3], evidence: 'Demo record', model_version: 'demo-seed', prompt_version: 'n/a', quality_band: 'usable', status, clinician_category: corr ?? null,
      reviewed_by: OKAFOR, reviewed_at: at(60 + i * 5, 9), created_at: at(60 + i * 5, 8) });
  });
}

// Background patients: stable cases that give the calendar realistic load and history.
const bg: string[] = [];
for (const [f, l, hue, stage] of [['Ava', 'Thompson', 12, 9], ['Leon', 'Fischer', 200, 14], ['Maya', 'Singh', 320, 6], ['Arjun', 'Das', 150, 17], ['Sophie', 'Laurent', 40, 11], ['Kai', 'Nakamura', 260, 4]] as const) {
  const { id, planId } = mkPatient({ first: f, last: l, dob: '1994-03-03', protocol: P_STD, hue, plan: { total: 24, stageDays: 14, stage, daysOn: 5, attachments: STD_ATT } });
  wear(id, [22, 22.5, 23]);
  mkCheckin(id, planId, { daysAgo: 5, stage, images: img5((['a', 'b', 'c'] as const)[hue % 3]), decision: { type: 'go' } });
  bg.push(id);
}
// Completed visits in the past (last visit anchors the "review every N stages" rule).
for (const pid of sql.all("SELECT id FROM patients WHERE tenant_id = ? AND status = 'active'", T).map((r) => r.id)) appt(pid, -(20 + Math.floor(Math.random() * 30)), '09:30', 20, 'progress_review', 'completed');
const slots: [number, string, number, string][] = [[1, '09:00', 20, 'progress_review'], [1, '10:30', 30, 'ipr'], [1, '14:00', 30, 'attachment_replacement'], [2, '09:30', 20, 'progress_review'], [2, '11:00', 30, 'tracking_assessment'],
  [3, '08:30', 20, 'progress_review'], [3, '13:30', 30, 'refinement_scan'], [4, '10:00', 20, 'progress_review'], [6, '09:00', 30, 'ipr'], [7, '15:00', 45, 'debond'], [8, '11:30', 20, 'progress_review'], [9, '09:00', 20, 'progress_review']];
slots.forEach(([d, t, dur, type], i) => { const date = addDays(today(), d); const wd = new Date(`${date}T00:00:00Z`).getUTCDay(); if (wd >= 1 && wd <= 4) appt(bg[i % bg.length], d, t, dur, type, 'booked', OKAFOR, BR1, (i % 3) + 1); });

// Leads from the public smile assessment
for (const [name, email, answers, status, days] of [
  ['Chloe Martin', 'chloe.martin@example.com', { concern: 'Crowding', age: '25-34', previousTreatment: 'No', timeline: 'Within 3 months', preference: 'Clear aligners' }, 'new', 1],
  ['Ravi Menon', 'ravi.m@example.com', { concern: 'Gaps', age: '35-44', previousTreatment: 'Braces as a teen', timeline: 'Just researching', preference: 'No preference' }, 'contacted', 4],
  ['Isabelle Dupont', 'isa.dupont@example.com', { concern: 'Overbite', age: '18-24', previousTreatment: 'No', timeline: 'As soon as possible', preference: 'Clear aligners' }, 'consult_booked', 9],
] as const) sql.insert('leads', { id: newId('lead'), tenant_id: T, name, email, phone: null, answers_json: j.str(answers), image_ids_json: '[]', status, consent_marketing: 1, created_at: at(days, 16) });

// Integration: one API key (printed once) and a disabled example webhook endpoint
const apiKeySecret = `omk_live_${randomToken(24)}`;
sql.insert('api_keys', { id: newId('key'), tenant_id: T, name: 'Practice system sync (demo)', prefix: apiKeySecret.slice(0, 14), key_hash: sha256(apiKeySecret), scopes_json: j.str(['patients:read', 'patients:write', 'plans:write', 'appointments:read', 'decisions:read', 'checkins:read']), created_at: at(60) });
sql.insert('webhook_endpoints', { id: newId('whe'), tenant_id: T, url: 'https://pms.example.com/hooks/ortho-monitoring', secret_ciphertext: encryptString(`whsec_${randomToken(24)}`, tenantKey(T)),
  events_json: j.str(['decision.made', 'appointment.booked', 'appointment.recommended', 'issue.reported']), enabled: 0, created_at: at(60) });

// Optional: real AI provider from environment (never committed).
if (process.env.OMA_SEED_ANTHROPIC_KEY) {
  sql.insert('ai_provider_configs', { id: newId('aip'), scope: 'tenant', tenant_id: T, provider: 'anthropic', label: 'Anthropic (from env)', model: 'claude-opus-5', endpoint: null,
    key_ciphertext: encryptString(process.env.OMA_SEED_ANTHROPIC_KEY, tenantKey(T)), key_last4: process.env.OMA_SEED_ANTHROPIC_KEY.slice(-4), services_json: j.str(['observations']), priority: 1,
    monthly_budget_usd: 50, per_call_max_usd: 0.5, enabled: 1, created_by: OKAFOR, created_at: at(1) });
}

// ── Tenant B: Cedar Smiles (separate clinic; used to demonstrate isolation) ──
const TB = newId('ten');
sql.insert('tenants', { id: TB, name: 'Cedar Smiles', slug: 'cedar-smiles', status: 'active', plan_id: 'plan_starter', branding_json: j.str({ accent: '#5B4B8A', displayName: 'Cedar Smiles', logoText: 'C' }), settings_json: '{}',
  data_key_wrapped: newWrappedDataKey(), onboarding_json: j.str({ profile: true, branch: true }), created_at: at(40) });
const BRB = newId('br');
sql.insert('branches', { id: BRB, tenant_id: TB, name: 'Cedar Smiles Leeds', timezone: 'Europe/London', address: '8 Park Row, Leeds', chairs: 2, hours_json: '{}' });
const CEDAR_ADMIN = newId('usr');
sql.insert('users', { id: CEDAR_ADMIN, tenant_id: TB, email: 'owner@cedar-smiles.demo', name: 'Dr. Hannah Clarke', password_hash: hashPassword(PASSWORD), role: 'clinic_admin', title: 'Orthodontist · Owner', branch_ids_json: '[]', created_at: at(40) });
const cedarProtocols = seedTenantDefaults(TB, CEDAR_ADMIN);
for (const [f, l] of [['Amelia', 'Hughes'], ['Liam', 'Walsh'], ['Freya', 'Dixon']])
  sql.insert('patients', { id: newId('pat'), tenant_id: TB, branch_id: BRB, doctor_id: CEDAR_ADMIN, first_name: f, last_name: l, dob: '1995-01-01', mode: 'aligner', protocol_id: cedarProtocols[0], status: 'active', consent_json: j.str(FULL_CONSENT), avatar_hue: 260, created_at: at(30) });

// ── Run the real submission pipeline for Tom (quality service → automatic retake request) ──
const tomOutcome = await processSubmission(T, TOM_CHECKIN);

// ── Compute go/no-go, priorities and appointment recommendations with the real engines ──
for (const r of sql.all("SELECT id FROM checkins WHERE tenant_id = ? AND status = 'awaiting_review'", T)) computeCheckinSignals(T, r.id);
for (const r of sql.all("SELECT id FROM patients WHERE tenant_id = ? AND status = 'active'", T)) refreshRecommendation(T, r.id);
audit({ tenantId: T, actorType: 'system', action: 'seed.complete', meta: { patients: sql.get('SELECT COUNT(*) AS n FROM patients WHERE tenant_id = ?', T)?.n } });
audit({ tenantId: null, actorType: 'system', action: 'seed.complete' });

console.log(`
Seed complete (password for all demo accounts: ${PASSWORD})
  Clinic workspace   amara.okafor@lumen-ortho.demo   (clinic admin + orthodontist)
                     daniel.reyes@lumen-ortho.demo   (orthodontist, Northgate only)
                     leo.martins@lumen-ortho.demo    (treatment coordinator)
                     sofia.bianchi@lumen-ortho.demo  (front desk)
  Second clinic      owner@cedar-smiles.demo         (isolation demo)
  Super admin        admin@orthomonitoring.ai
  Tom Becker check-in pipeline → ${tomOutcome.status} (${tomOutcome.views.join(', ')})
  Integration API key (shown once): ${apiKeySecret}
  Patient app: invite a patient from the clinic workspace to get an activation code (clinic code: lumen-ortho)
`);
setTimeout(() => closeDb(), 500);
