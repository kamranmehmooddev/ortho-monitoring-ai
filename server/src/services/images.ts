import { sql, j } from '../db/db.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { sniffMime, stripJpegMetadata } from '../lib/images.js';
import { badRequest } from '../lib/http.js';
import { sha256 } from '../security/crypto.js';
import { putBlob } from './storage.js';
import { assessImage, type QualityResult } from './quality/imageQuality.js';

export interface StoreImageOpts {
  tenantId: string; patientId: string; ownerType: 'checkin' | 'reference' | 'issue' | 'message' | 'lead'; ownerId: string | null;
  view?: string | null; withAligner?: boolean | null; kind?: string; patientOverride?: boolean; capturedAt?: string | null; runQuality?: boolean;
}

/** Validates, strips metadata, runs the quality service, encrypts and stores an image. */
export function storeImage(raw: Buffer, o: StoreImageOpts) {
  const mime = sniffMime(raw);
  if (!mime) throw badRequest('Only JPEG and PNG images are accepted');
  const data = mime === 'image/jpeg' ? stripJpegMetadata(raw) : raw;
  let quality: QualityResult | null = null;
  let width: number | null = null, height: number | null = null;
  try {
    quality = assessImage(data, mime, o.view);
    width = quality.width; height = quality.height;
  } catch { throw badRequest('Image could not be decoded'); }
  const id = newId('img');
  const key = `${o.patientId}/${id}`;
  putBlob(o.tenantId, key, data);
  sql.insert('images', {
    id, tenant_id: o.tenantId, patient_id: o.patientId, owner_type: o.ownerType, owner_id: o.ownerId, view: o.view ?? null,
    with_aligner: o.withAligner == null ? null : o.withAligner ? 1 : 0, kind: o.kind ?? o.ownerType, storage_key: key, mime, sha256: sha256(data),
    width, height, bytes: data.length, quality_json: quality && o.runQuality !== false ? j.str(quality) : null,
    quality_status: quality && o.runQuality !== false ? quality.status : null, patient_override: o.patientOverride ? 1 : 0,
    captured_at: o.capturedAt ?? null, created_at: nowIso(),
  });
  return { id, quality, mime };
}

export const serializeImage = (i: any) => i && ({
  id: i.id, view: i.view, withAligner: i.with_aligner == null ? null : !!i.with_aligner, kind: i.kind, width: i.width, height: i.height,
  quality: j.parse(i.quality_json, null), qualityStatus: i.quality_status, patientOverride: !!i.patient_override, capturedAt: i.captured_at, createdAt: i.created_at,
  ownerType: i.owner_type, ownerId: i.owner_id,
});
