// The rules of the Student Information module that need no database: the path a student's status
// follows, birth certificate numbers, who may see which part of a student, what an export may hold,
// the alert strip, and the alphabetical class list. Server code, pages and tests share them.
import type { ExitReason, StudentStatus } from '@prisma/client';
import { can, type AccessUser, type PermissionKey } from '@/lib/access-core';

// ─── Status ──────────────────────────────────────────────────────────────────
// Every move along the path is an explicit action with a reason and an audit entry:
//   ACTIVE ⇄ SUSPENDED (Head only; ends by itself)
//   ACTIVE / SUSPENDED → TRANSFERRED | GRADUATED | WITHDRAWN | EXPELLED | DECEASED (leaving process, Head approves)
//   TRANSFERRED | WITHDRAWN | GRADUATED → ACTIVE (rejoin on the old record)

export const STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  TRANSFERRED: 'Transferred',
  GRADUATED: 'Graduated',
  WITHDRAWN: 'Withdrawn',
  EXPELLED: 'Expelled',
  DECEASED: 'Deceased',
};

export const LEFT_STATUSES: readonly StudentStatus[] = ['TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'EXPELLED', 'DECEASED'];
/** Students who count as being at the school: they have a class and appear on class lists. */
export const AT_SCHOOL_STATUSES: readonly StudentStatus[] = ['ACTIVE', 'SUSPENDED'];
/** Who may come back on their old record. An expelled student needs a fresh decision; a deceased one cannot. */
export const REJOIN_STATUSES: readonly StudentStatus[] = ['TRANSFERRED', 'WITHDRAWN', 'GRADUATED'];

export const isAtSchool = (s: StudentStatus) => AT_SCHOOL_STATUSES.includes(s);
export const canSuspend = (s: StudentStatus) => s === 'ACTIVE';
export const canStartLeaving = (s: StudentStatus) => isAtSchool(s);
export const canRejoin = (s: StudentStatus) => REJOIN_STATUSES.includes(s);

/** The status a student ends in for each reason for leaving. */
export function statusForExit(reason: ExitReason): StudentStatus {
  switch (reason) {
    case 'TRANSFER': return 'TRANSFERRED';
    case 'COMPLETED_O_LEVEL':
    case 'COMPLETED_A_LEVEL': return 'GRADUATED';
    case 'EXPELLED': return 'EXPELLED';
    case 'DECEASED': return 'DECEASED';
    case 'WITHDRAWN_BY_GUARDIAN':
    case 'RELOCATED_ABROAD':
    case 'OTHER': return 'WITHDRAWN';
  }
}

export const EXIT_REASON_LABEL: Record<ExitReason, string> = {
  TRANSFER: 'Transfer to another school',
  COMPLETED_O_LEVEL: 'Completed O Level',
  COMPLETED_A_LEVEL: 'Completed A Level',
  WITHDRAWN_BY_GUARDIAN: 'Withdrawn by guardian',
  RELOCATED_ABROAD: 'Relocated outside Zimbabwe',
  EXPELLED: 'Expelled',
  DECEASED: 'Deceased',
  OTHER: 'Other',
};

/**
 * A suspension lasts through its end date; the student is Active again the day after.
 * Dates are YYYY-MM-DD, compared as text.
 */
export const suspensionHasEnded = (endDate: string, today: string) => today > endDate;

// ─── Birth certificate numbers ───────────────────────────────────────────────
// Zimbabwe format: district (2 digits), registration number (5–8 digits), a check letter and the
// year (2 digits): 63-123456 A 42. People type spaces, dashes or slashes; the database holds
// 63123456A42 so that the same certificate can never be saved twice under different spellings.

const BIRTH_CERT = /^(\d{2})(\d{5,8})([A-Z])(\d{2})$/;

export function normaliseBirthCert(raw: string): string {
  return raw.replace(/[\s/-]+/g, '').toUpperCase();
}

export const isValidBirthCert = (raw: string) => BIRTH_CERT.test(normaliseBirthCert(raw));

/** 63123456A42 → 63-123456 A 42. Anything that does not fit the format is shown as it was stored. */
export function formatBirthCert(stored: string): string {
  const m = BIRTH_CERT.exec(stored);
  return m ? `${m[1]}-${m[2]} ${m[3]} ${m[4]}` : stored;
}

// ─── Who sees what ───────────────────────────────────────────────────────────

export interface StudentAccess {
  profile: boolean;
  create: boolean;
  edit: boolean;
  export: boolean;
  import: boolean;
  guardians: boolean;
  editGuardians: boolean;
  /** Guardian national ID numbers and student birth certificate numbers. */
  idNumbers: boolean;
  enrolment: boolean;
  manageEnrolment: boolean;
  approveEnrolment: boolean;
  documents: boolean;
  uploadDocuments: boolean;
  generateDocuments: boolean;
  discipline: boolean;
  recordIncident: boolean;
  approveDiscipline: boolean;
  medical: boolean;
  editMedical: boolean;
  exportMedical: boolean;
  startLeaving: boolean;
  approveLeaving: boolean;
  activity: boolean;
}

export function studentAccess(user: AccessUser | null | undefined): StudentAccess {
  const has = (k: PermissionKey) => can(user, k);
  return {
    profile: has('students.profiles.view'),
    create: has('students.profiles.create'),
    edit: has('students.profiles.edit'),
    export: has('students.profiles.export'),
    import: has('students.profiles.import'),
    guardians: has('students.guardians.view'),
    editGuardians: has('students.guardians.edit'),
    idNumbers: has('students.guardians.view_ids'),
    enrolment: has('students.enrolment.view'),
    manageEnrolment: has('students.enrolment.manage'),
    approveEnrolment: has('students.enrolment.approve'),
    documents: has('students.documents.view'),
    uploadDocuments: has('students.documents.upload'),
    generateDocuments: has('students.documents.generate'),
    discipline: has('students.discipline.view'),
    recordIncident: has('students.discipline.create'),
    approveDiscipline: has('students.discipline.approve'),
    medical: has('students.medical.view'),
    editMedical: has('students.medical.edit'),
    exportMedical: has('students.medical.export'),
    startLeaving: has('students.leavers.manage'),
    approveLeaving: has('students.leavers.approve'),
    activity: has('system.audit.view'),
  };
}

// ─── Profile tabs ────────────────────────────────────────────────────────────
// Each role sees only the tabs it may. Other modules (Fees, Results, Attendance, Library, Hostel)
// register their own tab with registerStudentTab() and the profile page adds the ones the user may see.

export interface StudentTabDef {
  key: string;
  label: string;
  permission: PermissionKey;
  /** Other permissions that also open the tab (the tab then decides how much to show). */
  alsoFor?: PermissionKey[];
}

const CORE_TABS: StudentTabDef[] = [
  { key: 'overview', label: 'Overview', permission: 'students.profiles.view' },
  { key: 'guardians', label: 'Guardians', permission: 'students.guardians.view' },
  { key: 'enrolment', label: 'Enrolment', permission: 'students.enrolment.view' },
  { key: 'documents', label: 'Documents', permission: 'students.documents.view' },
  { key: 'discipline', label: 'Discipline', permission: 'students.discipline.view' },
  { key: 'medical', label: 'Medical', permission: 'students.medical.view' },
  { key: 'activity', label: 'Activity', permission: 'system.audit.view' },
];

const registered: StudentTabDef[] = [];

/** For other modules: add a tab to the student profile. Registering the same key again replaces it. */
export function registerStudentTab(tab: StudentTabDef) {
  const i = registered.findIndex((t) => t.key === tab.key);
  if (i >= 0) registered[i] = tab;
  else registered.push(tab);
}

/** The tabs this user may open, in order (the core tabs, then modules' tabs). */
export function visibleStudentTabs(user: AccessUser | null | undefined): StudentTabDef[] {
  return [...CORE_TABS, ...registered].filter((t) => can(user, t.permission) || (t.alsoFor ?? []).some((k) => can(user, k)));
}

// ─── Exports ─────────────────────────────────────────────────────────────────
// Medical, discipline and ID-number columns only appear for a user who may see them. The same list
// drives the CSV, the print and the audit entry (which records the columns that were left in).

export interface ExportColumn {
  key: string;
  label: string;
  /** Without this permission the column is silently left out. */
  requires?: PermissionKey;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'admissionNumber', label: 'Admission number' },
  { key: 'surname', label: 'Surname' },
  { key: 'firstName', label: 'First names' },
  { key: 'gender', label: 'Gender' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'age', label: 'Age' },
  { key: 'class', label: 'Class' },
  { key: 'status', label: 'Status' },
  { key: 'boarding', label: 'Boarding' },
  { key: 'house', label: 'House' },
  { key: 'admissionDate', label: 'Admission date' },
  { key: 'previousSchool', label: 'Previous school' },
  { key: 'isBeam', label: 'BEAM' },
  { key: 'sponsorName', label: 'Sponsor' },
  { key: 'guardianName', label: 'Primary guardian', requires: 'students.guardians.view' },
  { key: 'guardianPhone', label: 'Guardian phone', requires: 'students.guardians.view' },
  { key: 'birthCertificateNumber', label: 'Birth certificate number', requires: 'students.guardians.view_ids' },
  { key: 'guardianNationalId', label: 'Guardian national ID', requires: 'students.guardians.view_ids' },
  { key: 'incidentCount', label: 'Discipline incidents', requires: 'students.discipline.view' },
  { key: 'medicalAlert', label: 'Medical alert', requires: 'students.medical.export' },
  { key: 'specialNeedsNote', label: 'Special needs', requires: 'students.medical.export' },
];

/** The requested columns the user may export, in the standard order. No request means every allowed column. */
export function exportColumnsFor(user: AccessUser | null | undefined, requested?: readonly string[]): ExportColumn[] {
  return EXPORT_COLUMNS.filter((c) => (!requested || requested.includes(c.key)) && (!c.requires || can(user, c.requires)));
}

// ─── Alert strip ─────────────────────────────────────────────────────────────

export interface AlertInput {
  /** Severe allergies by name, e.g. ["penicillin"]. Included only when the viewer may see medical details. */
  severeAllergies?: string[];
  /** True when there is a severe allergy or serious condition; shown to everyone as a plain line. */
  hasMedicalAlert?: boolean;
  suspension?: { endDate: string } | null;
  specialNeeds?: boolean;
  custodyNotes?: string[];
}

export interface Alert {
  kind: 'medical' | 'suspension' | 'special-needs' | 'custody';
  text: string;
}

/**
 * The strip under the header. Without medical access only the alert line is shown ("Medical alert:
 * severe allergy"); with it, the allergy is named ("Allergy: penicillin"). Returns [] when nothing applies.
 */
export function buildAlerts(input: AlertInput, opts: { canSeeMedical: boolean }): Alert[] {
  const out: Alert[] = [];
  if (input.hasMedicalAlert || input.severeAllergies?.length) {
    out.push({
      kind: 'medical',
      text: opts.canSeeMedical && input.severeAllergies?.length
        ? `Allergy: ${input.severeAllergies.join(', ')}`
        : 'Medical alert: severe allergy',
    });
  }
  if (input.suspension) out.push({ kind: 'suspension', text: `Suspended until ${input.suspension.endDate}` });
  if (input.specialNeeds) out.push({ kind: 'special-needs', text: 'Special educational needs' });
  for (const note of input.custodyNotes ?? []) out.push({ kind: 'custody', text: note });
  return out;
}

// ─── Class list ──────────────────────────────────────────────────────────────

export interface ListedStudent { surname: string; firstName: string; gender: 'M' | 'F' | null }

/** Alphabetical by surname, then first name; accents and case are ignored. */
export function sortBySurname<T extends ListedStudent>(rows: readonly T[]): T[] {
  const cmp = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  return [...rows].sort((a, b) => cmp.compare(a.surname, b.surname) || cmp.compare(a.firstName, b.firstName));
}

/** Numbered names: together in one list, or boys and girls listed separately (each numbered from 1). */
export function classListSections<T extends ListedStudent>(rows: readonly T[], separate: boolean): { title: string | null; students: T[] }[] {
  if (!separate) return [{ title: null, students: sortBySurname(rows) }];
  const boys = sortBySurname(rows.filter((r) => r.gender === 'M'));
  const girls = sortBySurname(rows.filter((r) => r.gender === 'F'));
  const unknown = sortBySurname(rows.filter((r) => r.gender !== 'M' && r.gender !== 'F'));
  return [
    { title: 'Boys', students: boys },
    { title: 'Girls', students: girls },
    ...(unknown.length ? [{ title: 'Gender not recorded', students: unknown }] : []),
  ];
}
