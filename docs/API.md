# Ortho Monitoring AI: API reference

Base URL: `https://<host>/api/v1`. Machine-readable spec: [`openapi.yaml`](openapi.yaml), served at `/api/v1/openapi.yaml`.

## Authentication

| Caller | Header | Notes |
|---|---|---|
| Clinic staff | `Authorization: Bearer <JWT>` from `POST /auth/login` | HS256, 12 h. Carries tenant, role and branches. RBAC per route. |
| Patient app | `Authorization: Bearer omp_…` from `POST /patient/activate` | Bound to one patient. Revoked on re-activation or archive. |
| Integrations | `Authorization: Bearer omk_live_…` | Created in Settings → API & webhooks. Stored as a SHA-256 hash. Scoped. |
| Super admin | Platform JWT | No access to patient records or images. |

Errors: `{"error": {"code": "not_found", "message": "…", "details": …}}`. Resources belonging to another clinic or
branch return **404** (never 403) so their existence is not revealed.

## Integration API (`/integrations`, API key)

| Method | Path | Scope | Description |
|---|---|---|---|
| GET | `/integrations/patients?external_ref=` | `patients:read` | List or match patients by PMS reference |
| POST | `/integrations/patients` | `patients:write` | Idempotent upsert by `external_ref` (consent required) |
| PUT | `/integrations/patients/{id}/plan` | `plans:write` | Import a treatment plan from an aligner plan viewer: stages, attachments, IPR, doctor instructions |
| GET | `/integrations/appointments?from&to` | `appointments:read` | Booked visits |
| GET | `/integrations/recommendations` | `appointments:read` | Proposed visits with date window, chair time, uncertainty and factors |
| GET | `/integrations/decisions?since` | `decisions:read` | Go / no-go / retake / visit decisions |
| GET | `/integrations/checkins?since` | `checkins:read` | Check-in status feed (no images) |

Example plan import:

```json
PUT /integrations/patients/pat_…/plan
{ "system": "Clear aligners", "total_upper": 24, "total_lower": 22, "stage_days": 14, "start_date": "2026-09-01",
  "doctor_instructions": "IPR 0.3mm 12/13 at stage 10. Rescan if tracking poor.",
  "attachments": [{ "tooth": 13, "type": "optimized" }, { "tooth": 23, "type": "optimized" }],
  "ipr": [{ "tooth_a": 12, "tooth_b": 13, "amount_mm": 0.3, "stage": 10 }] }
```

## Webhooks

Events: `patient.created`, `plan.updated`, `checkin.submitted`, `checkin.reviewed`, `decision.made`, `stage.advanced`,
`issue.reported`, `appointment.recommended`, `appointment.booked`, `appointment.updated`.

```http
POST https://your-system.example.com/hooks
X-OMA-Event: decision.made
X-OMA-Signature: t=1790000000,v1=5b1c…
{"id":"evt_…","type":"decision.made","created_at":"…","tenant_id":"ten_…","data":{"decision_id":"dec_…","patient_id":"pat_…","type":"go","stage_to":9}}
```

Verify the signature by computing `HMAC_SHA256(secret, t + "." + rawBody)` and comparing it with `v1`, using a
constant-time comparison. Reject any request whose `t` is more than 5 minutes old. Delivery is at-least-once, with
retries after 1 m, 5 m, 30 m, 2 h and 12 h. An endpoint is disabled after 20 consecutive failures. Payloads never
contain images or free-text clinical notes.

```js
import crypto from 'node:crypto';
function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const mac = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return Math.abs(Date.now() / 1000 - Number(t)) < 300 && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(v1));
}
```

## Patient app API (`/patient`, patient token)

`POST /patient/activate` · `GET /patient/home` · `POST /patient/checkins` (idempotent by `clientUuid`) ·
`POST /patient/checkins/{id}/images` (multipart: `image`, `view`, `withAligner`, `patientOverride`, `capturedAt`;
deduplicated by content hash; a retake replaces the earlier photo of the same view) · `POST /patient/checkins/{id}/submit` ·
`GET /patient/checkins/{id}` · `POST /patient/quality-check` · `POST /patient/issues` (multipart, idempotent) ·
`GET|POST /patient/messages` · `POST /patient/wear` · `GET /patient/education` · `GET /patient/progress` ·
`GET /patient/appointments` · `POST /patient/logout`.

## Clinic API (staff JWT)

Dashboard `GET /dashboard` · Review `GET /review-queue`, `GET /checkins/{id}`, `POST /checkins/{id}/decision`,
`POST /review-queue/batch-go`, `POST /checkins/{id}/reanalyze`, `POST /checkins/{id}/findings`, `POST /checkins/{id}/eval-case` ·
Findings `POST /findings/{id}/review` (`confirm|dismiss|correct|reopen`) · Images `GET /images/{id}`,
`POST /images/{id}/annotations`, `DELETE /annotations/{id}` · Patients `GET|POST /patients`, `GET|PATCH /patients/{id}`,
`PUT /patients/{id}/plan`, `POST /patients/{id}/invite`, `GET /patients/{id}/timeline`, `POST /patients/{id}/reference-images`,
`PATCH /ipr/{id}`, `POST /instructions/parse` · Triage `GET /triage`, `POST /triage/{id}` · Scheduling `GET|POST /appointments`,
`PATCH /appointments/{id}`, `GET /recommendations`, `POST /recommendations/{id}`, `POST /patients/{id}/recommendation/refresh`,
`GET /slots`, `GET /availability`, `PUT /availability/{doctorId}` · Messages `GET /messages`, `GET|POST /patients/{id}/messages` ·
Library `GET|POST /instructions`, `DELETE /instructions/{id}`, `GET|POST /education`, `GET|POST /protocols`, `PUT /protocols/{id}` ·
Leads `GET /leads`, `PATCH /leads/{id}` · Settings `GET|PUT /settings/clinic`, `POST /settings/branches`, `PUT /settings/scheduling`,
`PUT /settings/retention`, `GET|POST /team`, `PATCH /team/{id}`, `GET|POST /ai-providers`, `PATCH|DELETE /ai-providers/{id}`,
`GET|POST /api-keys`, `DELETE /api-keys/{id}`, `GET|POST /webhooks`, `DELETE /webhooks/{id}`, `GET /audit`, `GET /audit/verify`,
`GET /evaluation/summary`.

## Super admin (`/admin`, platform JWT)

`GET /admin/overview` · `GET|POST /admin/tenants` · `PATCH /admin/tenants/{id}` · `GET /admin/plans` ·
`GET|POST /admin/ai-providers` · `PATCH /admin/ai-providers/{id}` · `GET /admin/model-registry` · `GET /admin/audit` ·
`GET /admin/audit/verify` · `GET /admin/health`.

## Public

`GET /public/clinics/{slug}` (branding only) · `POST /public/smile/{slug}` (lead capture, rate-limited, consent required).
