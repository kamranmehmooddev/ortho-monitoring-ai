-- Ortho Monitoring AI schema (SQLite dialect; Postgres-portable types).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, price_month_usd REAL, limits_json TEXT NOT NULL, features_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  plan_id TEXT REFERENCES subscription_plans(id), branding_json TEXT NOT NULL DEFAULT '{}',
  settings_json TEXT NOT NULL DEFAULT '{}', data_key_wrapped TEXT NOT NULL,
  onboarding_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC', address TEXT, hours_json TEXT NOT NULL DEFAULT '{}', chairs INTEGER NOT NULL DEFAULT 3
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL, title TEXT, branch_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active', failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
  last_login_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS protocols (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, mode TEXT NOT NULL,
  checkin_interval_days INTEGER NOT NULL, required_views_json TEXT NOT NULL, go_criteria_json TEXT NOT NULL,
  reminder_json TEXT NOT NULL DEFAULT '{}', grace_hours INTEGER NOT NULL DEFAULT 48, description TEXT
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  doctor_id TEXT REFERENCES users(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL, dob TEXT, email TEXT, phone TEXT,
  guardian_json TEXT, mode TEXT NOT NULL DEFAULT 'aligner', protocol_id TEXT REFERENCES protocols(id),
  status TEXT NOT NULL DEFAULT 'invited', activation_code_hash TEXT, activation_expires_at TEXT,
  consent_json TEXT NOT NULL DEFAULT '{}', external_ref TEXT, avatar_hue INTEGER DEFAULT 180, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_patients_tenant ON patients(tenant_id, status);

CREATE TABLE IF NOT EXISTS patient_devices (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id),
  token_hash TEXT NOT NULL, platform TEXT, created_at TEXT NOT NULL, revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS treatment_plans (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id), system TEXT,
  total_upper INTEGER NOT NULL, total_lower INTEGER NOT NULL, stage_days INTEGER NOT NULL, start_date TEXT NOT NULL,
  current_stage INTEGER NOT NULL DEFAULT 1, doctor_instructions TEXT, instruction_tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_stages (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES treatment_plans(id),
  stage_no INTEGER NOT NULL, expected_start TEXT NOT NULL, expected_change TEXT NOT NULL, actual_start TEXT,
  approved_by TEXT, approved_at TEXT, status TEXT NOT NULL DEFAULT 'upcoming'
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES treatment_plans(id),
  tooth_fdi INTEGER NOT NULL, type TEXT NOT NULL, surface TEXT NOT NULL DEFAULT 'buccal',
  placed_stage INTEGER NOT NULL DEFAULT 1, removed_stage INTEGER
);

CREATE TABLE IF NOT EXISTS ipr_events (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES treatment_plans(id),
  tooth_a INTEGER NOT NULL, tooth_b INTEGER NOT NULL, amount_mm REAL NOT NULL, stage_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned', done_at TEXT, done_by TEXT
);

CREATE TABLE IF NOT EXISTS planned_visits (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES treatment_plans(id),
  stage_no INTEGER NOT NULL, reason TEXT NOT NULL, procedures_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, owner_type TEXT NOT NULL,
  owner_id TEXT, view TEXT, with_aligner INTEGER, kind TEXT NOT NULL DEFAULT 'checkin',
  storage_key TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL, width INTEGER, height INTEGER, bytes INTEGER,
  quality_json TEXT, quality_status TEXT, patient_override INTEGER NOT NULL DEFAULT 0, captured_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_images_owner ON images(tenant_id, owner_type, owner_id);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id), plan_id TEXT,
  client_uuid TEXT NOT NULL, stage_no INTEGER, reported_aligner INTEGER, wear_hours_bucket TEXT, fit TEXT,
  symptoms_json TEXT NOT NULL DEFAULT '[]', pain_level INTEGER DEFAULT 0, concerns TEXT,
  status TEXT NOT NULL DEFAULT 'uploading', priority_score REAL DEFAULT 0, priority_reasons_json TEXT NOT NULL DEFAULT '[]',
  gonogo_json TEXT, ai_status TEXT, submitted_at TEXT, reviewed_at TEXT, reviewed_by TEXT, created_at TEXT NOT NULL,
  UNIQUE(patient_id, client_uuid)
);
CREATE INDEX IF NOT EXISTS ix_checkins_status ON checkins(tenant_id, status);

CREATE TABLE IF NOT EXISTS issue_reports (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id), client_uuid TEXT,
  category TEXT NOT NULL, severity_self INTEGER, pain_level INTEGER, details TEXT, urgency TEXT NOT NULL,
  urgency_reasons_json TEXT NOT NULL DEFAULT '[]', triage_status TEXT NOT NULL DEFAULT 'open', sla_due_at TEXT,
  assignee_id TEXT, resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY, tenant_id TEXT, service TEXT NOT NULL, provider TEXT, config_id TEXT, model TEXT,
  model_version TEXT, prompt_version TEXT, input_hash TEXT, latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER,
  cost_usd REAL DEFAULT 0, status TEXT NOT NULL, error TEXT, subject_id TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, checkin_id TEXT NOT NULL REFERENCES checkins(id), patient_id TEXT NOT NULL,
  ai_run_id TEXT, source TEXT NOT NULL, category TEXT NOT NULL, region_fdi_json TEXT NOT NULL DEFAULT '[]', view TEXT,
  image_id TEXT, bbox_json TEXT, assessment TEXT NOT NULL, novelty TEXT NOT NULL DEFAULT 'unknown',
  uncertainty TEXT NOT NULL, confidence REAL, rationale TEXT, evidence TEXT, needs_better_image INTEGER NOT NULL DEFAULT 0,
  patient_visible INTEGER NOT NULL DEFAULT 0, model_version TEXT, prompt_version TEXT, quality_band TEXT,
  status TEXT NOT NULL DEFAULT 'open', clinician_category TEXT, clinician_note TEXT, reviewed_by TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_findings_checkin ON findings(tenant_id, checkin_id);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, image_id TEXT NOT NULL, author_id TEXT NOT NULL, kind TEXT NOT NULL,
  geometry_json TEXT NOT NULL, label TEXT, color TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, checkin_id TEXT, patient_id TEXT NOT NULL, type TEXT NOT NULL,
  stage_from INTEGER, stage_to INTEGER, hold_days INTEGER, retake_views_json TEXT, instruction_id TEXT, message TEXT,
  decided_by TEXT NOT NULL, decided_at TEXT NOT NULL, recommendation_json TEXT, overrode_recommendation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointment_recommendations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, checkin_id TEXT, kind TEXT NOT NULL,
  earliest TEXT NOT NULL, latest TEXT NOT NULL, target_date TEXT NOT NULL, duration_min INTEGER NOT NULL,
  uncertainty TEXT NOT NULL, factors_json TEXT NOT NULL, slot_json TEXT, engine_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', final_date TEXT, final_duration INTEGER, decided_by TEXT, decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, patient_id TEXT NOT NULL, doctor_id TEXT,
  chair INTEGER NOT NULL DEFAULT 1, start_at TEXT NOT NULL, duration_min INTEGER NOT NULL, type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked', recommendation_id TEXT, notes TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_appts ON appointments(tenant_id, start_at);

CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, doctor_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  weekday INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, sender_type TEXT NOT NULL, sender_id TEXT,
  body TEXT NOT NULL, image_ids_json TEXT NOT NULL DEFAULT '[]', automated_rule TEXT, client_uuid TEXT,
  read_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages ON messages(tenant_id, patient_id, created_at);

CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]', requires_doctor INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS education (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, body_md TEXT NOT NULL,
  category TEXT NOT NULL, read_minutes INTEGER DEFAULT 2, approved_by TEXT, published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wear_logs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id TEXT NOT NULL, date TEXT NOT NULL, hours REAL NOT NULL,
  UNIQUE(patient_id, date)
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT, answers_json TEXT NOT NULL,
  image_ids_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', consent_marketing INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tenant_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT,
  actor_name TEXT, action TEXT NOT NULL, entity TEXT, entity_id TEXT, patient_id TEXT, ip TEXT, meta_json TEXT,
  prev_hash TEXT, hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_tenant ON audit_log(tenant_id, seq);

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, tenant_id TEXT, provider TEXT NOT NULL, label TEXT NOT NULL,
  model TEXT NOT NULL, endpoint TEXT, key_ciphertext TEXT NOT NULL, key_last4 TEXT NOT NULL,
  services_json TEXT NOT NULL DEFAULT '["observations"]', priority INTEGER NOT NULL DEFAULT 1,
  monthly_budget_usd REAL NOT NULL DEFAULT 100, per_call_max_usd REAL NOT NULL DEFAULT 0.5,
  enabled INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, url TEXT NOT NULL, secret_ciphertext TEXT NOT NULL,
  events_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, endpoint_id TEXT NOT NULL, event TEXT NOT NULL, payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
  response_code INTEGER, last_error TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY, tenant_id TEXT, set_name TEXT NOT NULL, finding_category TEXT NOT NULL, image_id TEXT NOT NULL,
  checkin_id TEXT, label TEXT NOT NULL, notes TEXT, labelled_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS breakglass_requests (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, requested_by TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', approved_by TEXT, expires_at TEXT, created_at TEXT NOT NULL
);
