// How audit entries are shown: a readable action, the module, a link to the record, and the
// before/after comparison. No database imports, so the page, the drawer and the tests share it.

const SPECIAL: Record<string, string> = {
  CREATE_USER: 'User created',
  UPDATE_USER: 'User edited',
  INVITE_USER: 'User invited',
  ACCEPT_INVITE: 'Invite accepted',
  DEACTIVATE_USER: 'User deactivated',
  REACTIVATE_USER: 'User reactivated',
  RESET_PASSWORD: 'Password reset (temporary password)',
  CREATE_PASSWORD_RESET: 'Password reset (link)',
  USE_PASSWORD_RESET: 'Password reset link used',
  ROLES_CHANGED: 'Roles changed',
  IMPORT_USERS: 'Users imported',
  LOGIN_SUCCESS: 'Login succeeded',
  LOGIN_FAILED: 'Login failed',
  LOGIN_LOCKED: 'Login locked',
  UPDATE_SCHOOL_SETTINGS: 'School settings changed',
  UPDATE_FINANCE_SETTINGS: 'Finance settings changed',
  UPDATE_NUMBERING: 'Numbering changed',
  UPDATE_GRADING: 'Grading changed',
  UPDATE_FORMS: 'Forms changed',
  UPDATE_STREAMS: 'Streams changed',
  UPDATE_SCHOOL_MODULES: 'Modules changed',
  CREATE_ACADEMIC_YEAR: 'Year created',
  UPDATE_ACADEMIC_TERM: 'Term edited',
  OPEN_TERM: 'Term opened',
  CLOSE_TERM: 'Term closed',
  REOPEN_TERM: 'Term reopened',
  CREATE_CLASS: 'Class created',
  UPDATE_CLASS: 'Class edited',
  ARCHIVE_CLASS: 'Class archived',
  DELETE_CLASS: 'Class deleted',
  CREATE_CALENDAR_EVENT: 'Calendar event created',
  UPDATE_CALENDAR_EVENT: 'Calendar event edited',
  DELETE_CALENDAR_EVENT: 'Calendar event deleted',
  SUSPEND_STUDENT: 'Student suspended',
  END_SUSPENSION: 'Suspension ended',
  REQUEST_CLASS_MOVE: 'Class move requested',
  APPROVE_CLASS_MOVE: 'Class move approved',
  REJECT_CLASS_MOVE: 'Class move declined',
  ASSIGN_HOUSE: 'House assigned',
  EXPORT_STUDENTS: 'Student list exported',
  PRINT_STUDENT: 'Student profile or class list printed',
  IMPORT_STUDENTS: 'Students imported',
  REJOIN_STUDENT: 'Student rejoined',
  MEDICAL_VIEWED: 'Medical details viewed',
  UPDATE_MEDICAL: 'Medical details changed',
  UPLOAD_DOCUMENT: 'Document uploaded',
  VIEW_DOCUMENT: 'Document opened',
  GENERATE_LETTER: 'Letter generated',
  RECORD_INCIDENT: 'Incident recorded',
  DECIDE_INCIDENT_ACTION: 'Discipline action decided',
  RECORD_GUARDIAN_MEETING: 'Guardian meeting recorded',
  START_LEAVING: 'Leaving process started',
  APPROVE_LEAVING: 'Leaving approved',
  COMPLETE_LEAVING: 'Student left',
  UPDATE_ALUMNUS: 'Alumni record changed',
  EXPORT_ALUMNI: 'Alumni list exported',
  CREATE_INTAKE: 'Intake created',
  UPDATE_INTAKE: 'Intake changed',
  CREATE_APPLICATION: 'Application received',
  UPDATE_APPLICATION: 'Application changed',
  MOVE_APPLICATION: 'Application moved to another stage',
  APPROVE_OFFER: 'Offer approved',
  ENROL_APPLICANT: 'Applicant enrolled',
  SAVE_PROMOTION_DRAFT: 'Promotion draft saved',
  CONFIRM_PROMOTION: 'Promotion confirmed',
  CREATE_HOUSE: 'House created',
  UPDATE_HOUSE: 'House changed',
  SUPPORT_ACCESS_STARTED: 'Pfuma support looked in',
  SUPPORT_ACCESS_ENDED: 'Pfuma support left',
  DATA_CREATE: 'Record created',
  DATA_UPDATE: 'Record changed',
  DATA_DELETE: 'Record deleted',
};

const sentence = (code: string) => {
  const t = code.toLowerCase().replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "CREATE_USER" → "User created". Anything not listed reads as a sentence. */
export const actionLabel = (code: string) => SPECIAL[code] ?? sentence(code);

/** The module an entry belongs to, shown as the name used in the sidebar. */
export const MODULE_LABEL: Record<string, string> = {
  system: 'Dashboard & System',
  students: 'Student Information',
  academics: 'Academics',
  exams: 'Examinations',
  finance: 'Finance',
  hr: 'HR & Staff',
  facilities: 'Facilities & Operations',
  communication: 'Communication',
  platform: 'Pfuma support',
};
export const moduleLabel = (key: string | null | undefined) => (key ? MODULE_LABEL[key] ?? key : '—');

/** A friendly name for the kind of record. */
const ENTITY_LABEL: Record<string, string> = {
  SchoolClass: 'Class', AcademicYear: 'Academic year', AcademicTerm: 'Term', CalendarEvent: 'Calendar event',
  GradeBoundary: 'Grade boundary', SchoolModule: 'Module', ExpenseRequest: 'Expense request', FeeStructure: 'Fee structure',
  LibraryMember: 'Library member', BookCopy: 'Book copy', TermResult: 'Term result', ExchangeRate: 'Exchange rate',
  SubjectAssignment: 'Subject allocation', ClassMove: 'Class move', PromotionRun: 'Promotion', StudentDocument: 'Student document',
  DisciplineIncident: 'Discipline incident', IncidentStudent: 'Incident student', DisciplineAction: 'Discipline action',
  MedicalProfile: 'Medical profile', MedicationEntry: 'Medication', SickBayVisit: 'Sick bay visit', StudentExit: 'Leaving record',
  StudentGuardian: 'Guardian link',
};
export const entityLabel = (type: string) => ENTITY_LABEL[type] ?? type;

/** Where to open the record, for the kinds that have a page. */
export function recordHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'User': return `/admin/users?q=${encodeURIComponent(entityId)}`;
    case 'CalendarEvent': return '/system/calendar';
    case 'School': return '/system/settings';
    case 'AcademicYear':
    case 'AcademicTerm': return '/system/settings?tab=years';
    case 'SchoolClass':
    case 'Stream':
    case 'Level': return '/system/settings?tab=structure';
    case 'GradeBoundary': return '/system/settings?tab=grading';
    case 'Student': return `/students/${encodeURIComponent(entityId)}`;
    default: return null;
  }
}

// ─── Before and after ────────────────────────────────────────────────────────

export interface DiffRow { field: string; before: string; after: string; changed: boolean }

const show = (v: unknown): string => {
  if (v === undefined) return '—';
  if (v === null) return 'empty';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * Lines up the saved values before and after a change, field by field. A field that is in only one of
 * them, or whose value differs, is marked changed.
 */
export function diffValues(before: unknown, after: unknown): DiffRow[] {
  const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const b = asObject(before);
  const a = asObject(after);
  if (!b && !a) {
    if (before === undefined && after === undefined) return [];
    return [{ field: 'value', before: show(before), after: show(after), changed: JSON.stringify(before) !== JSON.stringify(after) }];
  }
  const fields = Array.from(new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]));
  return fields.map((field) => ({
    field,
    before: b && field in b ? show(b[field]) : '—',
    after: a && field in a ? show(a[field]) : '—',
    changed: JSON.stringify(b?.[field]) !== JSON.stringify(a?.[field]),
  }));
}
