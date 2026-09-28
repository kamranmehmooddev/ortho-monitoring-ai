import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sql, j } from '../db/db.js';
import { h, badRequest, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { config } from '../config.js';
import { audit } from '../services/audit.js';
import { storeImage } from '../services/images.js';

/** Public endpoints: clinic branding by slug and the smile-assessment lead funnel. No patient data is exposed. */
export const publicRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 3 } });

publicRouter.get('/clinics/:slug', h((req) => {
  const t = sql.get("SELECT name, slug, branding_json FROM tenants WHERE slug = ? AND status IN ('active','trial')", req.params.slug);
  if (!t) throw notFound('Clinic');
  return { name: t.name, slug: t.slug, branding: j.parse(t.branding_json, {}) };
}));

const recent = new Map<string, number[]>();
publicRouter.post('/smile/:slug', upload.array('photos', 3), h((req) => {
  const t = sql.get("SELECT id FROM tenants WHERE slug = ? AND status IN ('active','trial')", req.params.slug);
  if (!t) throw notFound('Clinic');
  const now = Date.now();
  const hits = (recent.get(req.ip ?? '') ?? []).filter((x) => now - x < 3600_000);
  if (hits.length >= 5) throw badRequest('Too many submissions. Please try again later.');
  recent.set(req.ip ?? '', [...hits, now]);
  const b = z.object({ name: z.string().min(2).max(80), email: z.string().email().optional().or(z.literal('')), phone: z.string().max(40).optional(),
    answers: z.string().transform((s) => JSON.parse(s)).pipe(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))),
    consentContact: z.literal('true'), consentMarketing: z.enum(['true', 'false']).default('false') }).parse(req.body);
  if (!b.email && !b.phone) throw badRequest('Please give an email address or phone number');
  const id = newId('lead');
  const imageIds = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => storeImage(f.buffer, { tenantId: t.id, patientId: id, ownerType: 'lead', ownerId: id, kind: 'lead', runQuality: false }).id);
  sql.insert('leads', { id, tenant_id: t.id, name: b.name, email: b.email || null, phone: b.phone ?? null, answers_json: j.str(b.answers), image_ids_json: j.str(imageIds), status: 'new', consent_marketing: b.consentMarketing === 'true' ? 1 : 0, created_at: nowIso() });
  audit({ tenantId: t.id, actorType: 'public', action: 'lead.create', entity: 'lead', entityId: id, ip: req.ip });
  return { ok: true, message: 'Thank you! The clinic team will review your smile and contact you.' };
}));
