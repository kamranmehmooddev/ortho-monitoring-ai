export type Role = 'platform_admin' | 'clinic_admin' | 'orthodontist' | 'dentist' | 'treatment_coordinator' | 'front_desk' | 'read_only';

export type Permission =
  | 'clinical.decide' | 'findings.review' | 'triage.manage' | 'messages.send' | 'appointments.book'
  | 'patients.write' | 'patients.read' | 'images.view' | 'settings.manage' | 'ai.manage' | 'audit.view'
  | 'evaluation.view' | 'leads.manage' | 'library.manage';

const clinician: Permission[] = ['clinical.decide', 'findings.review', 'triage.manage', 'messages.send', 'appointments.book',
  'patients.write', 'patients.read', 'images.view', 'evaluation.view', 'library.manage', 'leads.manage'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  platform_admin: [],
  clinic_admin: [...clinician, 'settings.manage', 'ai.manage', 'audit.view'],
  orthodontist: [...clinician, 'audit.view'],
  dentist: clinician,
  treatment_coordinator: ['triage.manage', 'messages.send', 'appointments.book', 'patients.write', 'patients.read', 'images.view', 'leads.manage'],
  front_desk: ['appointments.book', 'patients.read', 'leads.manage'],
  read_only: ['patients.read', 'images.view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  platform_admin: 'Platform admin', clinic_admin: 'Clinic admin', orthodontist: 'Orthodontist', dentist: 'Dentist',
  treatment_coordinator: 'Treatment coordinator', front_desk: 'Front desk', read_only: 'Read-only',
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role]?.includes(p) ?? false;
