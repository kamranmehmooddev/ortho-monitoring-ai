import { sql, j } from './db.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';

const ALL = ['front', 'left', 'right', 'upper', 'lower'];

/** Default protocols, reusable instructions and education for a new clinic (all editable). */
export function seedTenantDefaults(tenantId: string, approverId: string | null = null) {
  const protocols = [
    { name: 'Aligner · Standard 14-day', mode: 'aligner', interval: 14, views: ALL.map((v) => ({ view: v, with_aligner: v !== 'upper' && v !== 'lower' })), criteria: { toleranceDays: 1, minWearHours: 20, requireAllViews: true },
      description: 'Five views; bite views with aligners in to check seating, occlusal views without to check attachments.' },
    { name: 'Aligner · Accelerated 7-day', mode: 'aligner', interval: 7, views: ALL.map((v) => ({ view: v, with_aligner: v !== 'upper' && v !== 'lower' })), criteria: { toleranceDays: 0, minWearHours: 22, requireAllViews: true },
      description: 'Weekly changes; stricter wear requirement.' },
    { name: 'Aligner · Adult with IPR', mode: 'aligner', interval: 10, views: [...ALL.map((v) => ({ view: v, with_aligner: true })), { view: 'front', with_aligner: false }], criteria: { toleranceDays: 1, minWearHours: 20, requireAllViews: true },
      description: 'Adds a front view without aligners; IPR stages always require a visit.' },
    { name: 'Fixed appliance · 3-weekly', mode: 'fixed', interval: 21, views: ALL.map((v) => ({ view: v, with_aligner: false })), criteria: { toleranceDays: 3, minWearHours: 0, requireAllViews: false },
      description: 'Bracket, wire and elastic checks between adjustment visits.' },
    { name: 'Retention · Monthly', mode: 'retention', interval: 30, views: ['front', 'upper', 'lower'].map((v) => ({ view: v, with_aligner: false })), criteria: { toleranceDays: 7, minWearHours: 8, requireAllViews: false },
      description: 'Relapse watch and retainer fit.' },
  ];
  const ids: string[] = [];
  for (const p of protocols) {
    const id = newId('prt'); ids.push(id);
    sql.insert('protocols', { id, tenant_id: tenantId, name: p.name, mode: p.mode, description: p.description, checkin_interval_days: p.interval, required_views_json: j.str(p.views), go_criteria_json: j.str(p.criteria), grace_hours: 48, reminder_json: j.str({ hour: 19 }) });
  }
  const instructions = [
    { title: 'Chewies: seat aligners', category: 'Tracking', body: 'Use your chewies for 5–10 minutes, three times a day, biting gently along the whole arch. Focus on the front teeth where the aligner is not fully seated.' },
    { title: 'Stay on current aligner', category: 'Tracking', body: 'Please stay on your current aligner a few more days so it can fully seat before you move to the next one. Send a new check-in when asked.' },
    { title: 'Increase wear time', category: 'Compliance', body: 'Your aligners work best when worn 22 hours a day. Only take them out to eat, drink anything other than cold water, and brush.' },
    { title: 'Lost attachment: keep wearing', category: 'Attachments', body: 'Keep wearing your aligners as normal. We will replace the attachment at a short visit. Keep the attachment if you find it.' },
    { title: 'Cracked aligner: go back one', category: 'Appliance', body: 'Please go back to your previous aligner and wear it full time until we can send a replacement. Do not skip ahead.' },
    { title: 'Great progress', category: 'Encouragement', body: 'Everything looks on track. Keep up the excellent wear time!' },
  ];
  for (const i of instructions) sql.insert('instructions', { id: newId('ins'), tenant_id: tenantId, title: i.title, body: i.body, category: i.category, tags_json: '[]', requires_doctor: i.category === 'Encouragement' ? 0 : 1, created_at: nowIso() });
  const education = [
    { title: 'How to take great check-in photos', category: 'Photos', min: 2, summary: 'Five photos, good light, steady hands.', body: '## Before you start\n- Brush and dry your teeth with a tissue\n- Face a window or a bright lamp\n- Put your cheek retractor in so your back teeth show\n\n## During capture\nFollow the outline on screen. The shutter turns green when the photo is sharp and bright enough. If it asks for a retake, the tip tells you exactly what to change.' },
    { title: 'Using chewies', category: 'Aligners', min: 2, summary: 'Help your aligners seat fully.', body: 'Bite gently on the chewie, moving it from back to front, for 5–10 minutes. Do this after putting in a new aligner and whenever the aligner feels loose at the edges.' },
    { title: 'Cleaning your aligners', category: 'Hygiene', min: 3, summary: 'Keep them clear and fresh.', body: 'Rinse your aligners every time you take them out. Brush them gently with a soft brush and cool water, never hot. Brush your teeth before putting aligners back in.' },
    { title: 'What if an attachment comes off?', category: 'Aligners', min: 1, summary: 'No need to panic.', body: 'Keep wearing your aligners and report it in the app with a photo. Your clinic will decide if it needs replacing and when.' },
    { title: 'Eating with braces', category: 'Fixed appliances', min: 3, summary: 'Protect your brackets.', body: 'Avoid hard, sticky or chewy foods (nuts, toffee, crusty bread). Cut food into small pieces. Report a loose bracket or poking wire in the app.' },
  ];
  for (const e of education) sql.insert('education', { id: newId('edu'), tenant_id: tenantId, title: e.title, summary: e.summary, body_md: e.body, category: e.category, read_minutes: e.min, approved_by: approverId, published: 1, created_at: nowIso() });
  return ids;
}
