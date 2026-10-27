import { can, type AccessUser } from '@/lib/access-core';
import { guardianContact, serializeGuardian } from './guardian';
import { omit, pick, type Row } from './mask';

/** Fields that never leave the server whatever the person holds: the parent-portal link and its PIN. */
const SECRETS = ['portalToken', 'portalTokenHash', 'portalPinHash'];
/** Medical details (students.medical.view); everyone else gets only the alert line. */
const MEDICAL = ['medicalNotes', 'specialNeeds', 'specialNeedsNote', 'medical', 'sickBayVisits'];
/** Discipline history (students.discipline.view); everyone else gets nothing. */
const DISCIPLINE = ['incidents', 'disciplineActions'];
/** Fee amounts and statements (finance.statements.view); a class teacher gets a "fees outstanding" flag only. */
const FEES = ['charges', 'payments', 'finCharges', 'finPayments', 'balance', 'balanceCents', 'balances', 'feesOwed', 'owesFees', 'statement'];
const LOOKUP = ['id', 'admissionNumber', 'firstName', 'surname', 'fullName', 'preferredName', 'currentClassId', 'currentClass', 'className', 'photoUrl', 'status'];

/**
 * How much of a learner the person sees, from what they hold: 'full' (guardians, enrolment, edits), 'basic' (a teacher or boarding
 * master: name, class, photo, guardian contact) or 'lookup' (a bursar, clerk or librarian finding the right child).
 */
export function studentDetailLevel(user: AccessUser): 'full' | 'basic' | 'lookup' {
  if (can(user, 'students.guardians.view') || can(user, 'students.profiles.edit') || can(user, 'students.enrolment.view')) return 'full';
  if (can(user, 'students.discipline.view') || can(user, 'students.discipline.create')) return 'basic';
  return 'lookup';
}

/** "Medical alert: severe allergy" when the file says so. Shown to anyone who may see the learner. */
export function medicalAlert(student: Row): string | null {
  if (typeof student.medicalAlert === 'string' && student.medicalAlert) return student.medicalAlert;
  const m = (student.medical ?? null) as Row | null;
  return m?.hasSevereAllergy ? 'Medical alert: severe allergy' : null;
}

/**
 * A learner for the browser. Never hand a raw Prisma Student to a response: pass it through here. It removes what the person's keys do
 * not allow; the caller still decides, with scopeWhere, WHICH learners they may see at all.
 */
export function serializeStudent(user: AccessUser, student: Row): Row {
  const alert = medicalAlert(student);
  const owes = typeof student.owesFees === 'boolean' ? student.owesFees : typeof student.balanceCents === 'number' ? student.balanceCents > 0 : undefined;
  let out: Row = omit(student, SECRETS);

  const level = studentDetailLevel(user);
  // The level decides how much of the profile; medical, discipline and fees are decided by their own keys below.
  if (level !== 'full') out = pick(out, [...LOOKUP, 'guardians', 'gender', ...MEDICAL, ...DISCIPLINE, ...FEES]);
  if (level === 'basic' && Array.isArray(out.guardians)) out.guardians = (out.guardians as Row[]).map((g) => guardianContact((g.guardian as Row | undefined) ?? g));
  if (level === 'lookup') delete out.guardians;
  if (level === 'full' && Array.isArray(out.guardians)) {
    out.guardians = (out.guardians as Row[]).map((g) => (g.guardian ? { ...g, guardian: serializeGuardian(user, g.guardian as Row) } : serializeGuardian(user, g)));
  }

  if (!can(user, 'students.medical.view')) out = omit(out, MEDICAL);
  if (alert) out.medicalAlert = alert;
  if (!can(user, 'students.discipline.view')) out = omit(out, DISCIPLINE);

  if (!can(user, 'finance.statements.view')) {
    out = omit(out, FEES);
    if (can(user, 'finance.arrears.flag') && owes !== undefined) out.feesOutstanding = owes;
  }
  return out;
}
