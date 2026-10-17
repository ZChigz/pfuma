// Figures for the dashboard summary cards. The calculations are pure so they can be
// tested; the loaders read one card's data each, always filtered to the caller's school.
import type { ScopedDb } from '@/lib/scoped-db';

const DAY = 864e5;
export const LOGIN_WINDOW_DAYS = 7;

export interface SummaryTerm { id: string; name: string; status: string; startDate: Date; endDate: Date }

// ─── Students ────────────────────────────────────────────────────────────────

/** Enrolments that ended with the student leaving mid-term do not count as active in that term. */
const LEFT = ['WITHDRAWN', 'TRANSFERRED_OUT'] as const;

export async function loadStudentSummary(db: ScopedDb, schoolId: string, term: SummaryTerm) {
  const active = { schoolId, termId: term.id, status: { notIn: [...LEFT] } };
  const [total, boys, girls] = await Promise.all([
    db.enrollment.count({ where: active }),
    db.enrollment.count({ where: { ...active, student: { gender: 'M' } } }),
    db.enrollment.count({ where: { ...active, student: { gender: 'F' } } }),
  ]);
  return { total, boys, girls, unrecorded: total - boys - girls };
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export async function loadStaffSummary(db: ScopedDb, schoolId: string, now = new Date()) {
  const since = new Date(now.getTime() - LOGIN_WINDOW_DAYS * DAY);
  const [active, recent] = await Promise.all([
    db.user.count({ where: { schoolId, active: true, isSupport: false } }),
    db.user.count({ where: { schoolId, active: true, isSupport: false, lastLoginAt: { gte: since } } }),
  ]);
  return { active, loggedInThisWeek: recent };
}

// ─── Term ────────────────────────────────────────────────────────────────────

export interface TermSummary {
  state: 'upcoming' | 'running' | 'ended';
  /** Whole weeks left, rounded up, counting the last day; 0 once the term has ended. */
  weeksRemaining: number;
  /** Weeks until it starts, for an upcoming term. */
  weeksUntilStart: number;
}

export function termSummary(term: { startDate: Date; endDate: Date }, now = new Date()): TermSummary {
  const start = term.startDate.getTime();
  const end = term.endDate.getTime() + DAY; // the end date is itself a school day
  const t = now.getTime();
  if (t < start) return { state: 'upcoming', weeksRemaining: Math.ceil((end - start) / (7 * DAY)), weeksUntilStart: Math.ceil((start - t) / (7 * DAY)) };
  if (t >= end) return { state: 'ended', weeksRemaining: 0, weeksUntilStart: 0 };
  return { state: 'running', weeksRemaining: Math.ceil((end - t) / (7 * DAY)), weeksUntilStart: 0 };
}

// ─── Classes ─────────────────────────────────────────────────────────────────

export interface ClassStats {
  classes: number;
  /** Students in the term divided by classes, to one decimal; 0 when there are no classes. */
  averageSize: number;
  overCapacity: number;
}

export function classStats(classes: { id: string; capacity: number }[], enrolledByClass: Map<string, number>): ClassStats {
  if (classes.length === 0) return { classes: 0, averageSize: 0, overCapacity: 0 };
  let students = 0;
  let over = 0;
  for (const c of classes) {
    const n = enrolledByClass.get(c.id) ?? 0;
    students += n;
    if (n > c.capacity) over++;
  }
  return { classes: classes.length, averageSize: Math.round((students / classes.length) * 10) / 10, overCapacity: over };
}

export async function loadClassSummary(db: ScopedDb, schoolId: string, term: SummaryTerm) {
  const [classes, grouped] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId, active: true }, select: { id: true, capacity: true } }),
    db.enrollment.groupBy({ by: ['classId'], where: { schoolId, termId: term.id, status: { notIn: [...LEFT] } }, _count: { _all: true } }),
  ]);
  return classStats(classes, new Map(grouped.map((g) => [g.classId, g._count._all])));
}
