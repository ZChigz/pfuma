// The dashboard's "is the school set up?" checklist. `evaluateSetup` is pure (facts in,
// steps out) so every rule can be tested; `loadSetupFacts` reads the facts for one school.
import type { ScopedDb } from '@/lib/scoped-db';

export interface SetupFacts {
  profile: { name: string; logoUrl: string | null; schoolType: string | null; province: string | null; zimsecCentreNumber: string | null };
  /** Number of terms in the school's best-filled academic year, and whether any term is open. */
  termsInYear: number;
  hasOpenTerm: boolean;
  activeClasses: number;
  gradeBoundaries: number;
  /** ZiG is switched on, so payments in ZiG need a rate to convert them. */
  zigEnabled: boolean;
  exchangeRates: number;
  receiptFormat: string | null;
  activeUsers: number;
  students: number;
  /** Events the school added itself (not the preloaded public holidays) inside the term being viewed; null when there is no term. */
  termEvents: number | null;
}

export interface SetupStep {
  key: string;
  label: string;
  done: boolean;
  /** What is still missing, shown under an unfinished step. */
  hint: string;
  href: string;
}

const filled = (v: string | null | undefined) => !!v && v.trim().length > 0;
export const TERMS_PER_YEAR = 3;

export function evaluateSetup(f: SetupFacts): SetupStep[] {
  const missingProfile = [
    !filled(f.profile.name) && 'name',
    !filled(f.profile.logoUrl) && 'logo',
    !filled(f.profile.schoolType) && 'type',
    !filled(f.profile.province) && 'province',
    !filled(f.profile.zimsecCentreNumber) && 'ZIMSEC centre number',
  ].filter(Boolean) as string[];

  // A school taking ZiG needs a rate on record before it can take a ZiG payment.
  const needsRate = f.zigEnabled && f.exchangeRates === 0;
  const money = [!filled(f.receiptFormat) && 'receipt number format', needsRate && 'an exchange rate'].filter(Boolean) as string[];

  return [
    { key: 'profile', label: 'School profile filled in', done: missingProfile.length === 0, hint: `Missing: ${missingProfile.join(', ')}`, href: '/system/settings' },
    {
      key: 'terms', label: 'Academic year and terms created, one term open',
      done: f.termsInYear >= TERMS_PER_YEAR && f.hasOpenTerm,
      hint: f.termsInYear < TERMS_PER_YEAR ? `${f.termsInYear} of ${TERMS_PER_YEAR} terms created` : 'No term is open',
      href: '/admin/academic',
    },
    { key: 'classes', label: 'Forms and streams set up, classes created', done: f.activeClasses > 0, hint: 'No classes yet', href: '/admin/classes' },
    { key: 'grading', label: 'Grading scale chosen', done: f.gradeBoundaries > 0, hint: 'No grade boundaries saved', href: '/admin/subjects' },
    { key: 'money', label: 'Currencies and receipt numbering set', done: money.length === 0, hint: `Missing: ${money.join(', ')}`, href: '/system/settings' },
    { key: 'staff', label: 'Staff users added (at least one besides the admin)', done: f.activeUsers > 1, hint: 'Only one active user', href: '/system/users' },
    { key: 'students', label: 'Students imported', done: f.students > 0, hint: 'No students yet', href: '/admin/students' },
    {
      key: 'calendar', label: "Calendar has this term's key dates",
      done: (f.termEvents ?? 0) > 0,
      hint: f.termEvents === null ? 'No term to put dates in' : 'No events inside this term',
      href: '/system/calendar',
    },
  ];
}

export function summarize(steps: SetupStep[]) {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

export async function loadSetupFacts(
  db: ScopedDb,
  schoolId: string,
  term: { startDate: Date; endDate: Date } | null,
): Promise<SetupFacts> {
  const [school, years, openTerms, activeClasses, gradeBoundaries, exchangeRates, activeUsers, students, termEvents] = await Promise.all([
    db.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { name: true, logoUrl: true, schoolType: true, province: true, zimsecCentreNumber: true, currencyZigEnabled: true, receiptFormat: true },
    }),
    db.academicYear.findMany({ where: { schoolId }, select: { _count: { select: { terms: true } } } }),
    db.academicTerm.count({ where: { schoolId, status: 'OPEN' } }),
    db.schoolClass.count({ where: { schoolId, active: true } }),
    db.gradeBoundary.count({ where: { schoolId } }),
    db.exchangeRate.count({ where: { schoolId } }),
    db.user.count({ where: { schoolId, active: true, isSupport: false } }),
    db.student.count({ where: { schoolId } }),
    term
      ? db.calendarEvent.count({ where: { schoolId, autoKey: null, startDate: { lte: term.endDate }, endDate: { gte: term.startDate } } })
      : Promise.resolve(null),
  ]);
  return {
    profile: school,
    termsInYear: Math.max(0, ...years.map((y) => y._count.terms)),
    hasOpenTerm: openTerms > 0,
    activeClasses,
    gradeBoundaries,
    zigEnabled: school.currencyZigEnabled,
    exchangeRates,
    receiptFormat: school.receiptFormat,
    activeUsers,
    students,
    termEvents,
  };
}

/** Shown while any step is open, or when an administrator pinned it from School Settings. */
export const checklistVisible = (complete: boolean, pinned: boolean) => !complete || pinned;
