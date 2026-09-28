import { sql, j } from '../db/db.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';

/**
 * Automated patient messages. Only NON-CLINICAL rules fire automatically (reminders, quality-based retake requests,
 * encouragement, receipt confirmations). Clinical content is sent only as part of a clinician decision.
 */
export type AutoRule = 'retake_quality' | 'checkin_received' | 'checkin_reminder' | 'wear_encouragement' | 'issue_received';

export function systemMessage(tenantId: string, patientId: string, body: string, rule: AutoRule | 'decision', senderId: string | null = null) {
  const id = newId('msg');
  sql.insert('messages', { id, tenant_id: tenantId, patient_id: patientId, sender_type: rule === 'decision' ? 'staff' : 'system', sender_id: senderId,
    body, image_ids_json: '[]', automated_rule: rule === 'decision' ? null : rule, created_at: nowIso() });
  return id;
}

export function staffMessage(tenantId: string, patientId: string, senderId: string, body: string, imageIds: string[] = []) {
  const id = newId('msg');
  sql.insert('messages', { id, tenant_id: tenantId, patient_id: patientId, sender_type: 'staff', sender_id: senderId, body, image_ids_json: j.str(imageIds), created_at: nowIso() });
  return id;
}
