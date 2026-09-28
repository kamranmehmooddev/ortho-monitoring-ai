# Ortho Monitoring AI — Product Specification

Version 1.0 · Author: Kamran Mehmood · Status: Implemented (Phase 1–2), Planned (Phase 3–4)

> **Positioning.** Guided check-ins that lead to a clear doctor decision. Every check-in ends in one of four
> outcomes: *Go* (advance aligner), *No-go* (stay / re-seat / chewies), *Retake*, or *Visit*. We explain the
> reason for the next appointment and how much chair time to hold, and the orthodontist can change both.
>
> **Clinical boundary.** Ortho Monitoring AI is a clinical *workflow* tool. The AI output is *observations for
> clinician review*. It is not a diagnostic device. Phone photos cannot reliably confirm completed IPR, and they
> will not catch every debonded attachment, broken bracket or cracked aligner. The product shows no accuracy
> claims until an accuracy figure has been measured against clinician-labelled cases (see §8.6).

---

## Table of contents

1. Product overview and personas
2. User journeys
3. Screen map
4. Data model
5. API design and webhooks
6. AI architecture
7. Image-comparison approach
8. Go/No-go, triage and appointment rules
9. Security, privacy and compliance model
10. SaaS: tenancy, roles, subscriptions, usage limits
11. Design system
12. Phased implementation plan
13. Competitive landscape and differentiation

---

## 1. Product overview and personas

| Surface | Users | Purpose |
|---|---|---|
| **Clinic workspace** (responsive web) | Orthodontist, associate dentist, treatment coordinator (TC), front desk, clinic admin | Review check-ins, decide go/no-go, triage, schedule, message, configure |
| **Patient app** (Android, Kotlin/Compose) | Patient, parent/guardian of a minor | Guided photo check-ins, wear log, issue reports, chat, education, appointments |
| **Super admin console** (web) | Platform operator (Ortho Monitoring AI staff) | Tenants, subscriptions, usage, platform AI keys, health, audit |
| **Public smile assessment** (web) | Prospective patient | Lead capture that goes into the clinic's lead inbox (optional per clinic) |
| **Public API + webhooks** | Practice-management systems (PMS), aligner treatment-plan viewers | Sync patients, plans, appointments, decisions |

### Personas
- **Dr. Amara Okafor, orthodontist.** Has 25 minutes between patients to clear the review queue. She needs the
  most urgent case first, a side-by-side view against the last check-in, and a one-click *Go* when a check-in is
  routine.
- **Leo Martins, treatment coordinator.** Works the triage queue, handles patient messages, books the visits the
  engine recommends, and chases overdue check-ins.
- **Priya Shah, patient, 16 (and her guardian).** Wants to finish a check-in in under 3 minutes, know whether she
  can switch aligners tonight, and know when her next visit is.
- **Platform operator.** Onboards clinics, watches AI spend and error rates, enforces plan limits.

### Monitoring modes
- **Clear aligners** (primary): tracking and seating, attachments, go/no-go stage advancement, IPR follow-up.
- **Fixed appliances**: bracket or tube debond, wire poke/breakage, elastic wear compliance, archwire progression.
- **Retention**: relapse watch, retainer fit.
- **Hygiene overlay** (all modes): possible plaque, gingival inflammation and soft-tissue lesions. These are
  always "for review" and never shown to the patient as a finding before the clinician has seen them.

---

## 2. User journeys

### J1 — Clinic onboards a patient and plan (TC, 4 minutes)
1. **Patients → New patient.** Enter demographics, contact, guardian (if a minor), branch, treating doctor and
   consent (photos, AI processing, messaging, research use: each can be granted separately).
2. Pick a **monitoring protocol**, for example "Aligner, standard 14-day" or "Aligner, adult with IPR". The
   protocol sets the check-in cadence, the required views, with/without-aligner requirements, the go/no-go
   criteria and the reminder schedule.
3. Enter the **treatment plan**: aligner system, number of upper/lower stages, stage duration, start date. Expected
   change dates are generated automatically and can be edited per stage. Record the **attachment map** (tooth
   FDI → attachment type, stage placed), **IPR schedule** (between which teeth, amount in mm, at which stage), planned
   visits and doctor instructions (free text plus structured tags).
4. Upload **baseline reference images** (the photos taken when attachments were bonded, or plan-viewer screenshots).
5. **Invite the patient.** The patient receives an SMS/e-mail with a one-time activation code. The app pairs the
   device with a single-patient, scoped token.

### J2 — Patient check-in (patient, 2–4 minutes)
1. The home screen shows **Today's action** ("Check-in due today", "Switch to aligner 9 tonight: approved",
   "Retake 2 photos").
2. **Pre-flight**: it confirms the current aligner number (prefilled), asks about wear hours (quick chips: <16,
   16–20, 20–22, 22+) and symptoms (none / soreness / sharp edge / poor fit / pain level 0–10), and asks for
   concerns in free text.
3. **Guided capture** of each required view (front bite, left bite, right bite, upper occlusal, lower occlusal,
   each with or without aligners as the protocol requires):
   - A framing overlay drawn for that view (a bite outline for buccal views, an arch outline for occlusal views),
     plus a mirror tip for the occlusal views.
   - Voice prompts (TTS, can be muted): "Put in your retractor. Turn your head slightly left. Bite on your back
     teeth."
   - **Live checks** on the preview (luminance, contrast, sharpness measured as Laplacian variance, and frame
     stability). The shutter goes green only when every check passes. The patient can capture anyway after 8
     seconds, and the photo is then marked "patient override".
   - **Post-capture check** runs the same metrics on the full-resolution frame. If a check fails, the app shows a
     specific retake reason ("Too dark: turn toward a window", "Blurry: hold still for a second").
4. **Review and send**: thumbnails, then Submit. Uploads are queued (encrypted at rest on the device) and sent in
   resumable chunks, one file at a time. A progress ring is shown and uploads continue in the background with
   WorkManager when connectivity returns.
5. The **status** of the check-in moves: `Queued → Uploading → Received → Quality check → Awaiting review →
   (Retake requested | Feedback received)`.

### J3 — Report an issue (patient, <1 minute)
Categories: cracked/broken aligner, lost aligner, attachment came off, poor fit/not seating, pain, sharp
edge/irritation, **fixed appliance**: loose bracket, poking wire, broken elastic hook; other. Each report
takes optional photos, a severity self-rating and free text. The triage engine (§8.2) assigns an urgency, P1 to
P4. **P1/P2 go to the staff triage queue straight away and trigger a staff notification. No appointment is
booked automatically.** The patient sees what to do while they wait, taken from clinic-approved guidance.
For example, a lost aligner shows: "Wear your previous aligner and do not skip ahead. The clinic will contact
you."

### J4 — Doctor review (orthodontist, 30–90 seconds per routine check-in)
1. **Review queue** is sorted by priority score (§8.3): urgency, then overdue time, then the age of the finding.
2. The **review workspace** has:
   - **Compare viewer**: current view vs previous check-in vs baseline, synced zoom/pan, a slider (wipe) mode,
     and annotation tools (pin, arrow, circle, freehand, measurement label).
   - **AI observations panel**. Each finding shows its category, region (FDI teeth), status
     (`possible` / `cannot assess` / `persistent` / `new`), uncertainty, the supporting image crops, model
     version, and buttons for **Confirm / Dismiss / Correct**.
   - **Quality summary** per view, with usable/limited/unusable ratings and reasons.
   - **Patient report**: aligner number, wear, symptoms, concerns and messages.
   - **Plan context**: current stage, expected change date, attachments on these teeth, IPR due at this stage.
   - **Go/No-go recommendation**, with the criteria it checked (§8.1).
   - **Next appointment recommendation**: date window, chair time, reasons, uncertainty.
3. **Decision** (one action; the clinical decision is always the doctor's):
   - *Go*: approve the next aligner. Optionally write a note to the patient from the reusable instruction library.
   - *No-go*: hold the current aligner for N days, prescribe chewies, re-check in N days.
   - *Retake*: request specific views, with a reason.
   - *Visit*: accept or edit the recommended date and duration. The TC is notified to book it.
4. Every finding reviewed and every decision is written to the **audit trail** and the **evaluation store** (§8.6).

### J5 — Staff triage (TC)
The triage queue shows P1/P2 patient reports, AI findings marked `urgent_review` and missed check-ins past the
grace period. The TC can call the patient, message them, escalate to a doctor, or create an appointment request.
SLA timers are shown (P1 15 min in clinic hours, P2 4 h).

### J6 — Appointment booking (TC)
The calendar shows doctor availability and chair (operatory) columns per branch. Recommended visits appear in an
"Unscheduled recommendations" rail, each showing its reason and duration. Dragging one onto a slot books it.
Before booking, the engine checks the duration fits, clinic rules (lunch, buffers, max emergencies per day) and
the doctor's skills (for example, IPR needs a doctor rather than a hygienist).

### J7 — Super admin
Create a tenant, choose a plan, set limits, brand defaults and platform AI keys. Monitor usage (active patients,
check-ins, AI calls, spend) and incidents. Tenant impersonation is **not** allowed. Support access uses
time-boxed, audited "break-glass" grants that the clinic admin approves.

### J8 — Prospective patient (smile assessment)
A public page for each clinic (`/s/{clinicSlug}`). The prospect uploads 3 photos and answers 6 questions, then
consents to contact. The result is a lead in the clinic's lead inbox. The prospect sees no AI "diagnosis", only
"Thanks, the clinic will review your smile and contact you."

---

## 3. Screen map

```
Clinic workspace (/app)
├─ Today                       KPIs, queues: Awaiting review · Triage · Overdue · Possible tracking issue
│                              · Attachment concerns · Broken/lost aligner · Ready for stage change · Upcoming visits
├─ Review queue (/app/review)  filter chips, keyboard j/k navigation, batch "Go" for routine green check-ins
│  └─ Review workspace (/app/review/:checkinId)
├─ Triage (/app/triage)        P1–P4 lanes, SLA timers
├─ Patients (/app/patients)    search, filters (branch, doctor, protocol, status)
│  ├─ New patient wizard       demographics → consent → protocol → plan → attachments/IPR → invite
│  └─ Patient profile (/app/patients/:id)
│     ├─ Overview  (stage ring, compliance, next change, next visit, open findings)
│     ├─ Timeline  (check-ins, decisions, reports, visits, messages; chronological)
│     ├─ Images    (view-by-view progression strip, compare any two dates)
│     ├─ Plan      (stages, change dates, attachment map, IPR, planned visits, instructions, stage history)
│     ├─ Messages  (secure thread)
│     └─ Audit     (patient-scoped audit trail)
├─ Calendar (/app/calendar)    day/week, per-doctor & per-chair columns, recommendation rail
├─ Messages (/app/messages)    inbox across patients
├─ Leads (/app/leads)          smile assessment submissions
├─ Library (/app/library)      reusable instructions, education articles (clinic-approved), protocols
├─ Evaluation (/app/evaluation) model versions, correction rates, false alerts, labelled case sets
└─ Settings (/app/settings)
   ├─ Clinic & branches · Branding · Team & roles · Scheduling rules · Protocols
   ├─ AI providers (BYO key) · Data retention & consent · API keys · Webhooks · Audit log · Subscription

Super admin console (/admin)
├─ Overview (tenants, MRR, active patients, AI spend, error rate)
├─ Tenants → tenant detail (plan, limits, usage, branches, status, break-glass requests)
├─ Plans & pricing · Platform AI providers · Model registry · Audit · System health

Patient app (Android)
├─ Activation (code) → Consent review
├─ Home: Today's action card · Aligner stage ring · Next change · Next appointment · Check-in status list
├─ Check-in flow: Pre-flight → Guided capture ×N → Review → Upload progress
├─ Report issue → category → photos → details → guidance
├─ Wear log (daily hours, streak, weekly chart)
├─ Chat (secure, attachments)
├─ Progress (before/now comparison approved by clinic, timeline)
├─ Learn (clinic-approved education)
└─ Settings (reminders, voice guidance, language, privacy, sign out)
```

---

## 4. Data model

All tenant-owned tables carry `tenant_id` (clinic organisation). Queries go through a repository layer that
**requires** a tenant context (§9.2). Primary keys are prefixed ULID-style strings (`pat_…`, `chk_…`).

```
tenants(id, name, slug, status, plan_id, branding_json, settings_json, data_key_wrapped, created_at)
branches(id, tenant_id, name, timezone, address, hours_json, chairs)
users(id, tenant_id NULL for platform, email, name, password_hash, role, branch_ids_json, title,
      mfa_enabled, status, last_login_at)
roles: platform_admin | clinic_admin | orthodontist | dentist | treatment_coordinator | front_desk | read_only
patients(id, tenant_id, branch_id, doctor_id, first_name, last_name, dob, email, phone, guardian_json,
         mode[aligner|fixed|retention], protocol_id, status[invited|active|paused|completed|archived],
         activation_code_hash, consent_json, external_ref, created_at)
protocols(id, tenant_id, name, mode, checkin_interval_days, required_views_json, with_without_aligner,
          go_criteria_json, reminder_json, grace_hours)
treatment_plans(id, tenant_id, patient_id, system, total_upper, total_lower, stage_days, start_date,
                current_stage, refinement_of, doctor_instructions, instruction_tags_json, status)
plan_stages(id, tenant_id, plan_id, stage_no, expected_start, expected_change, actual_start,
            approved_by, approved_at, status[upcoming|active|completed|held])
attachments(id, tenant_id, plan_id, tooth_fdi, type[optimized|rectangular|beveled|button|power_ridge],
            surface, placed_stage, removed_stage, baseline_image_id)
ipr_events(id, tenant_id, plan_id, tooth_a, tooth_b, amount_mm, stage_no, status[planned|done|skipped],
           done_at, done_by)
planned_visits(id, tenant_id, plan_id, stage_no, reason, procedures_json)
reference_images(id, tenant_id, patient_id, view, kind[baseline|plan_viewer|attachment_map], storage_key)
checkins(id, tenant_id, patient_id, plan_id, stage_no, reported_aligner, wear_hours_bucket, symptoms_json,
         pain_level, concerns, status[uploading|received|quality_check|awaiting_review|retake_requested|
         reviewed], priority_score, priority_reasons_json, submitted_at, reviewed_at, reviewed_by,
         client_uuid UNIQUE per patient (idempotent upload))
checkin_images(id, tenant_id, checkin_id, view, with_aligner, storage_key, sha256, width, height,
               quality_json, quality_status[usable|limited|unusable], patient_override, captured_at)
issue_reports(id, tenant_id, patient_id, category, severity_self, details, image_ids_json,
              urgency[P1..P4], triage_status[open|acknowledged|resolved], sla_due_at, assignee_id)
ai_runs(id, tenant_id, service[quality|observations|scheduling_explainer], provider, model,
        model_version, prompt_version, input_hash, latency_ms, tokens_in, tokens_out, cost_usd,
        status[ok|error|skipped|fallback], error, created_at)
findings(id, tenant_id, checkin_id, ai_run_id NULL, source[model|clinician|rule|seed_demo],
         category, region_fdi_json, view, bbox_json, assessment[possible|cannot_assess|not_seen],
         novelty[new|persistent|resolved|unknown], uncertainty[low|medium|high], confidence NULL,
         rationale, needs_better_image, status[open|confirmed|dismissed|corrected],
         clinician_category, clinician_note, reviewed_by, reviewed_at)
finding categories: tracking_gap · aligner_damage · attachment_missing · attachment_damaged · attachment_obscured
   · progress_deviation · spacing_change · bracket_debond · wire_issue · elastic_noncompliance · plaque
   · gingival_inflammation · soft_tissue_lesion · ipr_followup · other
annotations(id, tenant_id, image_id, author_id, kind, geometry_json, label, created_at)
decisions(id, tenant_id, checkin_id, patient_id, type[go|no_go|retake|visit], stage_from, stage_to,
          hold_days, retake_views_json, instruction_id, message, decided_by, decided_at,
          recommendation_json (snapshot of go/no-go + appointment rec at decision time),
          overrode_recommendation bool)
appointment_recommendations(id, tenant_id, patient_id, checkin_id, kind, earliest, latest, target_date,
          duration_min, confidence, factors_json, status[proposed|accepted|edited|dismissed],
          final_date, final_duration, decided_by)
appointments(id, tenant_id, branch_id, patient_id, doctor_id, chair, start_at, duration_min, type,
             status[requested|booked|completed|cancelled|no_show], recommendation_id, notes)
availability(id, tenant_id, doctor_id, branch_id, weekday, start_time, end_time)
messages(id, tenant_id, patient_id, sender_type[patient|staff|system], sender_id, body, image_ids_json,
         automated_rule, read_at, created_at)
instructions(id, tenant_id, title, body, category, tags_json, requires_doctor)
education(id, tenant_id, title, body_md, category, approved_by, published)
wear_logs(id, tenant_id, patient_id, date, hours)
leads(id, tenant_id, name, email, phone, answers_json, image_ids_json, status, created_at)
audit_log(id, tenant_id, actor_type, actor_id, action, entity, entity_id, patient_id, ip, meta_json,
          prev_hash, hash, created_at)          -- hash-chained, append-only
ai_provider_configs(id, scope[platform|tenant], tenant_id NULL, provider, label, model, endpoint,
          key_ciphertext, key_last4, services_json, priority, monthly_budget_usd, per_call_max_usd,
          enabled, created_by)
api_keys(id, tenant_id, name, prefix, key_hash, scopes_json, last_used_at, revoked_at)
webhook_endpoints(id, tenant_id, url, secret_ciphertext, events_json, enabled)
webhook_deliveries(id, tenant_id, endpoint_id, event, payload_json, status, attempts, next_attempt_at,
                   response_code)
subscription_plans(id, name, price_month_usd, limits_json, features_json)
usage_counters(tenant_id, period, active_patients, checkins, ai_calls, ai_cost_usd, storage_mb)
eval_cases(id, tenant_id NULL, finding_category, image_id, label_json, labelled_by, set_name)
retention_policies (inside tenants.settings_json): images_days, messages_days, audit_days (min 6y),
          purge_after_treatment_days
```

---

## 5. API design and webhooks

REST + JSON, versioned under `/api/v1`. Auth:
- **Staff**: `Authorization: Bearer <session JWT>` (HS256, 12 h, carries `sub, tid, role, bids`).
- **Patient app**: `Bearer <patient token>` (scope `patient`, bound to one patient id, rotated on each activation).
- **Integrations**: `Authorization: Bearer omk_live_…` API key with scopes (`patients:read`, `patients:write`,
  `plans:write`, `appointments:read|write`, `checkins:read`, `decisions:read`, `webhooks:manage`).
- **Super admin**: platform JWT (`role=platform_admin`, `tid=null`).

Selected endpoints (the full reference is in `docs/API.md` and `docs/openapi.yaml`):

| Method & path | Purpose |
|---|---|
| `POST /auth/login` · `GET /auth/me` | Staff sessions |
| `GET /dashboard` | KPI + queue counts for Today |
| `GET /review-queue?filter=` | Prioritised check-ins |
| `GET /checkins/:id` | Full review bundle (images, quality, findings, plan, prior check-in, recs) |
| `POST /checkins/:id/decision` | `{type: go|no_go|retake|visit, …}` |
| `POST /findings/:id/review` | `{action: confirm|dismiss|correct, category?, note?}` |
| `POST /checkins/:id/reanalyze` | Re-run observations (e.g. after adding an AI key) |
| `GET/POST /patients` · `GET/PATCH /patients/:id` | Patient CRUD |
| `PUT /patients/:id/plan` | Create/replace treatment plan (stages, attachments, IPR, visits) |
| `POST /patients/:id/invite` | Generate activation code |
| `GET /patients/:id/timeline` | Merged chronological events |
| `GET /images/:id` | Decrypted image stream (authorised, audited) |
| `POST /images/:id/annotations` | Annotation CRUD |
| `GET /triage` · `POST /triage/:id` | Triage queue actions |
| `GET /appointments?from&to` · `POST /appointments` · `PATCH /appointments/:id` | Calendar |
| `GET /recommendations` · `POST /recommendations/:id` | Accept/edit/dismiss recommendations |
| `GET/POST /messages/:patientId` | Secure chat |
| `GET/POST /instructions` · `/education` · `/protocols` | Libraries |
| `GET /evaluation/summary` | Correction, false-alert, missed-finding rates by model version |
| `GET/PUT /settings/*` · `/ai-providers` · `/api-keys` · `/webhooks` · `/audit` | Settings |
| **Patient app** `POST /patient/activate` · `GET /patient/home` · `POST /patient/checkins` (idempotent by `client_uuid`) · `POST /patient/checkins/:id/images` · `POST /patient/checkins/:id/submit` · `POST /patient/issues` · `GET/POST /patient/messages` · `POST /patient/wear` · `GET /patient/education` · `GET /patient/progress` | |
| **Admin** `GET /admin/overview` · `GET/POST/PATCH /admin/tenants` · `GET /admin/plans` · `GET/POST /admin/ai-providers` · `GET /admin/audit` | |
| **Public** `POST /public/smile/:slug` | Lead capture |

**Webhooks.** Events: `patient.created`, `plan.updated`, `checkin.submitted`, `checkin.reviewed`,
`decision.made`, `stage.advanced`, `issue.reported`, `appointment.recommended`, `appointment.booked`,
`appointment.updated`. Delivery: POST with JSON `{id, type, created_at, tenant_id, data}`, header
`X-OMA-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`, at-least-once, exponential backoff
(1 m, 5 m, 30 m, 2 h, 12 h), and the endpoint is disabled after 20 consecutive failures. Payloads carry ids and
minimum fields. Image bytes are never included. The receiver fetches them with an API key if it needs them.

---

## 6. AI architecture

Three separate services with their own interfaces, versions, tests and evaluation:

```
             ┌───────────────────────┐
 image ─────▶│ 1. Quality service    │  deterministic, on-device + server; no LLM
             │  exposure · contrast  │  → usable | limited | unusable + reasons
             │  sharpness · framing  │
             └──────────┬────────────┘
                        │ only usable/limited images
             ┌──────────▼────────────┐        ┌──────────────────────────┐
             │ 2. Observation service│◀──────▶│ Provider router          │
             │  prompt v-pinned,     │        │  adapters: Anthropic,    │
             │  JSON-schema output,  │        │  OpenAI, Gemini, Azure/  │
             │  validation, clamps   │        │  OpenAI-compatible       │
             └──────────┬────────────┘        │  budget · fallback · log │
                        │ findings (possible/ │  keys decrypted in-mem   │
                        │ cannot_assess)      └──────────────────────────┘
             ┌──────────▼────────────┐
             │ 3. Scheduling service │  deterministic rules engine (§8); an LLM may
             │  go/no-go · triage ·  │  only *parse* doctor free-text into tags,
             │  next visit + chair   │  which the doctor sees and can edit
             └───────────────────────┘
```

### 6.1 Quality service (deterministic)
Metrics are computed on a luminance downsample of about 256 px on the long edge:
- **Exposure**: mean luminance and the percentage of clipped highlights/shadows.
- **Contrast**: standard deviation of luminance.
- **Sharpness**: variance of the 3×3 Laplacian, normalised by resolution.
- **Framing**: the centre-weighted share of bright, low-saturation "tooth-like" pixels in the expected overlay
  region (a heuristic, labelled as such).
- **Resolution**: at least 720 px on the short edge.

Thresholds are versioned (`quality-v1.2`). The same algorithm runs in Kotlin on the device (live preview and
post-capture) and in TypeScript on the server, and the server's result is authoritative. Result: `usable` (all
pass), `limited` (one soft fail) or `unusable` (a hard fail). An unusable required view sets the check-in to
`retake_requested` automatically, and the patient gets a message saying which view failed and why. This is the
only fully automatic patient-facing action, and it is non-clinical.

### 6.2 Observation service (LLM, clinician-reviewed)
- **Inputs**: the usable current images for each view, the matching previous check-in image, the baseline
  reference, the plan context (stage, attachments on visible teeth, IPR due) and the patient report.
- **Prompt** (`obs-prompt-v3`) tells the model to act as an assistant that describes visible features. It must
  not diagnose. It must use `assessment ∈ {possible, cannot_assess, not_seen}` and never "confirmed". It must
  give uncertainty, list the evidence it saw, and set `needs_better_image` when the view is not enough. It is
  told explicitly that it cannot confirm IPR completion and cannot exclude a debonded attachment.
- **Output**: strict JSON that is validated against a schema. Anything that fails validation is discarded and
  logged, and never shown to the clinician.
- **Post-processing clamps**: `confidence` is kept for evaluation but shown only as a band. Any
  `assessment` other than the three allowed values becomes `possible`. For IPR only
  `ipr_followup/cannot_assess` is allowed. Hygiene findings are hidden from the patient until reviewed.
- **Novelty**: each new finding is matched with open or recently confirmed findings on the same category, tooth
  and view, and marked `new`, `persistent` or `resolved`.
- **No key configured means no findings.** The UI says "AI observations are off: no provider configured".
  The review still works with quality results, the go/no-go rules and the images. Seed/demo records are labelled
  `source=seed_demo` and show a "Demo data" badge.

### 6.3 Provider adapters and router
The interface is `analyze({images, system, user, schema, maxTokens}) → {json, usage, model, latency}`.
Adapters are provided for Anthropic Messages API, OpenAI Chat Completions, Google Gemini `generateContent`,
and OpenAI-compatible endpoints (Azure OpenAI, self-hosted vLLM, OpenRouter). For each call, the router:
1. builds an ordered list: clinic configurations for the service by priority, then platform configurations
   (if the plan allows them);
2. estimates the cost and skips any configuration whose monthly budget would be exceeded, or where a single call
   would exceed `per_call_max_usd`;
3. calls the adapter with a timeout, and on a 5xx, timeout or invalid JSON tries the next configuration
   (`status=fallback`);
4. writes an `ai_runs` row with the model, prompt version, tokens, cost, latency and outcome.

Keys are encrypted with AES-256-GCM using the tenant data key (envelope-wrapped by the platform master key).
They are decrypted only inside the router for one call and never returned by any API: responses show only
`key_last4`. Only `clinic_admin` can manage clinic keys and only `platform_admin` can manage platform keys. The
Android app has no AI endpoints and no provider hostnames.

---

## 7. Image-comparison approach

1. **View normalisation**: images are grouped by `(view, with_aligner)`. The comparison is always
   current vs the most recent *usable* earlier image of the same view, and optionally the baseline.
2. **Alignment**: the viewer aligns images using the capture overlay (the same framing on every capture) and
   manual 2-point alignment (the clinician clicks two landmarks per image and the viewer computes a
   similarity transform). Automatic feature-based registration is planned for Phase 3.
3. **Viewer modes**: side-by-side (synced zoom/pan), wipe slider, blink, and a three-up
   *baseline · previous · current* for attachment review.
4. **Findings anchoring**: each finding has a `bbox` (normalised 0–1) on a specific image. Clicking it zooms
   every panel to that region.
5. **Attachment comparison**: for each tooth in the attachment map that is visible in the view, the model
   receives the baseline crop and the current crop, and is asked for `present / possibly_missing /
   possibly_damaged / cannot_assess (obscured, angle, glare, aligner opacity)`. The UI labels "possibly missing"
   and "cannot assess from this photo" in different colours and wording.
6. **Tracking gaps**: the model is asked about a visible gap between the aligner edge and the incisal or
   cuspal surfaces, with teeth (FDI) and whether it is new or persistent compared with the prior image. A gap that
   is seen in two consecutive check-ins at the same tooth is marked `persistent` and weighted higher in go/no-go.
7. **Progress**: sequential check-ins are compared against expected plan movement for that stage window. Output
   is limited to "possible change warranting review" and does not measure millimetres.

---

## 8. Go/No-go, triage and appointment rules

### 8.1 Go/No-go (aligner stage advancement) — recommendation only
The recommendation is computed by the rules engine `gonogo-v1`. Its criteria come from the protocol and can be
edited per clinic:

| Criterion | Default | Effect |
|---|---|---|
| Days on current aligner ≥ planned stage days − tolerance | tolerance 1 day | otherwise **not yet** |
| All required views usable or limited | required | otherwise **retake first** |
| Reported wear ≥ 20 h/day (last 7 d median) | 20 h | below → **no-go (hold)** suggestion, reason "wear" |
| No open `tracking_gap` with uncertainty ≤ medium on the current stage | — | present → **no-go** "possible seating gap at 11, 21" |
| Persistent tracking gap (≥ 2 check-ins) | — | **visit** suggestion |
| No unresolved P1/P2 issue report | — | present → **hold pending triage** |
| Patient-reported fit is "good" | — | "poor fit" → **no-go** with chewies suggestion |
| IPR scheduled before next stage and not recorded as done | — | **visit** required, IPR is never assumed |
| Attachment `possibly_missing` on a tooth whose attachment is active | — | **review**, plus a suggested attachment-replacement visit |

Output: `{recommendation: go|no_go|retake|visit|not_yet, confidence: high|medium|low, checks:[{id, passed,
detail}], suggested_hold_days}`. Confidence is **low** when any required view is `limited`, when AI observations
are off, or when findings have high uncertainty. The recommendation is shown with its checks. Only a doctor's
decision changes the patient's stage. **Batch Go** is offered only for check-ins where every check passed, the
confidence is high and there are no open findings. The doctor still clicks to approve.

### 8.2 Urgency triage
| Priority | Triggers | SLA |
|---|---|---|
| **P1** | pain ≥ 8, swelling, bleeding that won't stop, allergic reaction, poking wire causing a laceration, a swallowed or inhaled appliance component | 15 min (clinic hours); patient shown emergency guidance |
| **P2** | lost aligner, cracked aligner with sharp edge, debonded bracket, broken wire, ≥ 2 attachments off, pain 5–7 | 4 h |
| **P3** | single attachment off, poor fit, mild irritation, broken elastic hook | next business day |
| **P4** | question, cosmetic concern | 3 business days |

Triage creates or updates a triage item. It **never books an appointment automatically**. It can create a
`recommendation` for staff to act on.

### 8.3 Review priority score
`score = 100·P1 + 60·P2 + 30·(open tracking gap) + 25·(attachment possibly missing) + 20·(retake loop ≥ 2)
+ 15·(overdue days, capped at 3) + 10·(low wear) + 5·(age in hours / 12, capped at 5)`, together with the reasons
behind it.

### 8.4 Next check-in
`next = last_checkin + protocol interval`, adjusted as follows:
- The date is moved to the expected change date if that falls earlier (so the check-in happens before a switch).
- It is shortened to 3–5 days after a no-go hold, to 2 days after a retake, and to 7 days if wear is low for 2
  consecutive check-ins.
- It is extended by up to 50 % after 3 consecutive clean "Go" check-ins with ≥ 21 h wear (adaptive).

### 8.5 Next clinic appointment and chair time
The **visit type** is chosen from the highest-need driver. The duration comes from clinic rules (defaults below)
plus the add-ons:

| Driver | Visit type | Base chair time |
|---|---|---|
| Planned visit in plan / every N stages | Progress review | 20 min |
| IPR due at stage k | IPR visit | 30 min + 5 min per contact beyond 2 |
| Attachment possibly missing / patient reports attachment loss | Attachment replacement | 20 min + 10 per extra tooth |
| Persistent tracking gap / poor fit | Tracking assessment | 30 min (+15 if refinement scan mentioned) |
| Broken bracket / wire | Repair | 20 min + 10 per extra bracket |
| Refinement scan (doctor instruction "refinement"/"rescan") | Scan | 30 min |
| Final stage reached | Debond / retention | 45–60 min |

**Doctor written instructions** are parsed with a deterministic keyword grammar (`instr-parse-v1`, which can
optionally be improved by an LLM that proposes tags for the doctor to accept). For example, "IPR 0.3 mm 12/13 at
stage 10", "rescan if tracking poor", "check attachments UR3" or "see at stage 12". Parsed tags are shown next to
the recommendation.

The **date window** is `[earliest, latest]`, anchored on the stage at which the procedure is needed (IPR must
happen *before* the stage that needs the space, so the window ends at that stage's expected change date). It is
then fitted to doctor availability, and procedures that need a doctor exclude hygienist-only slots. Clinic rules
apply: buffers, lunch, and the maximum number of long procedures per day.

**Uncertainty**: `high` if the driver comes only from `possible` findings with high uncertainty, `medium` if it
depends on patient self-report only, and `low` for plan-driven visits.

Each recommendation stores its `factors[]` (for example, "IPR 0.3 mm 12/13 planned before stage 10 (change
due 14 Oct)", "Attachment on 23 possibly missing in 2 consecutive check-ins", "Next free 30-min slot with
Dr. Okafor: Tue 10:30"). The doctor or TC can **accept**, **edit** (date or duration) or **dismiss** it. Edits are
logged as overrides and fed back into the evaluation store.

### 8.6 Evaluation workflow
- Every finding records the model and prompt version, the image quality, the uncertainty and the clinician
  outcome (confirm, dismiss or correct).
- **Missed findings**: a clinician-created finding (`source=clinician`) on a check-in that the model analysed
  counts as a miss for that category.
- Metrics per model version and category: confirmation rate (PPV proxy), false-alert rate (dismissed / total),
  correction rate and miss count. They are broken down by quality band.
- **Labelled case sets**: clinicians mark any reviewed image as an evaluation case. `npm run eval` replays a set
  against a provider configuration and produces a report. The accuracy screen stays labelled
  *"Operational review statistics, not validated diagnostic accuracy"* until a formal validation study is
  recorded.

---

## 9. Security, privacy and compliance model

### 9.1 Principles
HIPAA/GDPR-aligned design: minimum necessary access, consent before processing, encryption everywhere, and an
auditable history.

### 9.2 Tenancy isolation
- Each row carries `tenant_id`. Every repository function takes a `TenantContext` that comes from the verified
  token, never from the request body.
- The route layer has no way to query without a tenant context (unit-tested isolation suite).
- Branch scoping: users with `branch_ids` see only patients in those branches (clinic admins see all).
- Patient tokens are bound to one patient id.

### 9.3 Roles and permissions (excerpt)
| Permission | Admin | Ortho | Dentist | TC | Front desk | Read-only |
|---|---|---|---|---|---|---|
| Decide go/no-go, confirm/dismiss findings | ✓ | ✓ | ✓ | – | – | – |
| Triage, message, book | ✓ | ✓ | ✓ | ✓ | book only | – |
| Create patients & plans | ✓ | ✓ | ✓ | ✓ | – | – |
| View images | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Settings, AI keys, API keys, webhooks, retention | ✓ | – | – | – | – | – |

### 9.4 Encryption
- **In transit**: TLS 1.2+ and HSTS. Certificate pinning is optional in the Android app.
- **At rest**: images are encrypted with AES-256-GCM using a per-tenant data key. Data keys are wrapped by a
  platform master key (from KMS in production, from an environment variable in development). AI keys and webhook
  secrets use the same scheme.
- **On device**: queued photos are written to app-private storage and encrypted with the Android Keystore
  (AES-GCM). They are deleted after the server acknowledges them.

### 9.5 Consent, retention, backups
- Consent is granular: photos, AI processing, messaging, research/evaluation, and marketing (for leads). If AI
  processing consent is withdrawn, that patient's images are never sent to an LLM.
- Retention is set per clinic: image days, message days, purge after treatment, and audit ≥ 6 years. A nightly
  job purges expired data and records a tombstone in the audit log.
- Backups: nightly encrypted snapshots, 35-day point-in-time recovery, restore drills every quarter (production
  runbook).

### 9.6 Audit
The audit log is append-only and hash-chained (`hash = sha256(prev_hash + canonical(entry))`). It records logins,
image views, finding reviews, decisions, overrides, settings/key changes, exports, and break-glass sessions. The
chain can be verified from Settings → Audit.

### 9.7 Application security
Passwords use scrypt. Login attempts are rate limited and accounts lock out after repeated failures. Sessions are
JWTs with short lifetimes. Security headers are set on every response. Uploads are checked for size and type
(JPEG/PNG only) and EXIF metadata is removed. API keys are stored hashed (SHA-256) and shown once. Webhook URLs
must be HTTPS in production.

---

## 10. SaaS: tenancy, roles, subscriptions, usage limits

| Plan | Price | Active patients | Branches | Seats | AI | Features |
|---|---|---|---|---|---|---|
| **Starter** | $249/mo | 60 | 1 | 5 | BYO key only | Core monitoring, triage, calendar |
| **Practice** | $599/mo | 250 | 3 | 20 | BYO key or platform credits ($40 included) | + Protocols, webhooks, API, branding |
| **Group** | $1,490/mo | 1,000 | 15 | 100 | BYO + platform | + Evaluation workspace, SSO, custom retention, priority support |
| **Enterprise** | custom | custom | custom | custom | custom | + DPA/BAA, dedicated region |

Usage limits are enforced when active patients are created (soft warning at 90 %, hard stop at 110 %), on AI
calls (monthly budget) and on storage. Onboarding checklist: clinic profile → branch → team invite → protocol →
AI provider (optional) → first patient. Branding: logo, accent colour (validated for contrast), and the clinic
name shown in the patient app.

---

## 11. Design system ("Meridian")

- **Brand**: the Ortho Monitoring AI mark is a tooth outline in white with an orange-to-amber monitoring pulse ending in
  an amber dot. The wordmark is a serif lockup "Ortho Monitoring" with a gradient **AI** badge. It is reproduced as SVG
  (web, favicon), an Android adaptive-icon vector, and a native Compose canvas.
- **Typography**: *Inter* for the UI (tabular numbers for clinical data) and *Crimson Pro* for display headings and
  numerals, matching the wordmark. Type scale: 11/12/13/14/15/20/28/34/44.
- **Colour**: navy ink `#10133A` (sidebar, primary actions, dark lightbox chrome) on a warm porcelain canvas `#F7F6F2`.
  There is one accent family, **Ember → Amber** `#E8590C → #F5B400`, used only for brand moments, progress and focus.
  Status colours are muted: *Urgent* garnet `#B4232F`, *Attention* amber `#A86008`, *Stable* moss `#2F7D4F`, *Info*
  slate `#3D5A80`, *Uncertain* plum `#6B4E8F` (reserved for "cannot assess" and high uncertainty). A full dark theme
  redefines every token.
- **Spacing**: 4-pt base, generous page gutters (40 px on desktop), 1 px hairlines and soft shadows only on overlays.
- **Status labels** always pair colour with an icon and a word, never colour alone.
- **Image viewer**: photos sit on a neutral lightbox `#0B0C10` so colour is judged consistently. Supports synced
  zoom/pan, wipe, three-up, brightening, finding-region highlights and annotations.
- **Patient app**: Material 3 with the same tokens, 52–56 dp touch targets, and the clinic's validated accent colour on
  the "Today" card.

## 12. Phased implementation plan

| Phase | Scope | Status |
|---|---|---|
| **1. Core loop** | Tenancy, auth, RBAC, patients, plans, protocols, patient app capture with quality checks, upload queue, review workspace, decisions, go/no-go engine, triage, messaging, audit | **Implemented** |
| **2. Scheduling & AI** | Appointment engine with chair time, calendar, BYO-key router with Anthropic/OpenAI/Gemini/compatible adapters, observation service, evaluation dashboard, webhooks, API keys, super admin, leads | **Implemented** |
| **3. Depth** | Automatic image registration, fixed-appliance protocol library, PMS connectors (Dolphin, OrthoTrac, Dentrix), plan-viewer import (ClinCheck/uLab PDF), SSO/SAML, iOS app | Planned |
| **4. Validation** | Formal reader study on clinician-labelled set, per-category performance disclosure, regulatory assessment (FDA/MDR classification) before any detection claims | Planned |

---

## 13. Competitive landscape and differentiation

The market leaders (e.g. DentalMonitoring; also Ai Dent's aligner monitoring) offer guided scans, AI
observations, aligner go/no-go, fixed appliance and hygiene monitoring, urgency triage, automated messaging,
appointment optimisation, progress visualisation, lead tools and integrations. Ortho Monitoring AI covers the same
surface area and puts the weight on the two features that reduce chair time and make remote supervision
defensible:

1. **Explained go/no-go**: every recommendation lists the checks it ran and why each passed or failed, and the
   doctor's click is the decision.
2. **Urgency triage with SLAs**: patient reports and AI findings are triaged into P1–P4 with visible timers and
   are never turned into an automatic appointment.

It adds:
3. **Appointment timing and chair time with factors**: the engine explains *when* and *how long*, and learns
   from overrides.
4. **Model-agnostic BYO AI** with budgets and fallback. The clinic owns its AI cost and vendor choice.
5. **Honest uncertainty**: "cannot assess from this photo" is a first-class result.

Automated patient messaging is gated: reminders, retake requests (quality-based) and encouragement are automatic;
anything clinical is sent only after doctor approval, or through a clinic-approved instruction template the
doctor picks.
