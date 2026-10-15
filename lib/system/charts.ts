// Data for the dashboard charts, for the term being viewed, always school-scoped.
import type { ScopedDb } from '@/lib/scoped-db';
import type { SummaryTerm } from '@/lib/system/summary';

/** Enrolments that ended with the student leaving mid-term are not counted (same rule as the cards). */
const LEFT = ['WITHDRAWN', 'TRANSFERRED_OUT'] as const;

export interface ClassSize { id: string; name: string; levelId: string; capacity: number; count: number; boys: number; girls: number }

async function loadClassSizes(db: ScopedDb, schoolId: string, term: SummaryTerm): Promise<ClassSize[]> {
  const base = { schoolId, termId: term.id, status: { notIn: [...LEFT] } };
  const by = (extra: object) => db.enrollment.groupBy({ by: ['classId'], where: { ...base, ...extra }, _count: { _all: true } });
  const [classes, all, boys, girls] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId, active: true }, select: { id: true, name: true, levelId: true, capacity: true } }),
    by({}),
    by({ student: { gender: 'M' } }),
    by({ student: { gender: 'F' } }),
  ]);
  const n = (rows: { classId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.classId, r._count._all]));
  const [a, b, g] = [n(all), n(boys), n(girls)];
  return classes.map((c) => ({ ...c, count: a.get(c.id) ?? 0, boys: b.get(c.id) ?? 0, girls: g.get(c.id) ?? 0 }));
}

export interface FormEnrolment { levelId: string; name: string; order: number; boys: number; girls: number; unrecorded: number; total: number }

/** One row per form that has at least one class, in form order. */
export function enrolmentByForm(levels: { id: string; name: string; order: number }[], sizes: ClassSize[]): FormEnrolment[] {
  return levels
    .map((l) => {
      const mine = sizes.filter((c) => c.levelId === l.id);
      if (mine.length === 0) return null;
      const total = mine.reduce((s, c) => s + c.count, 0);
      const boys = mine.reduce((s, c) => s + c.boys, 0);
      const girls = mine.reduce((s, c) => s + c.girls, 0);
      return { levelId: l.id, name: l.name, order: l.order, boys, girls, unrecorded: total - boys - girls, total };
    })
    .filter((r): r is FormEnrolment => r !== null)
    .sort((x, y) => x.order - y.order);
}

/** Biggest class first; ties by name so the order is stable. */
export function sortBySize(sizes: ClassSize[]): ClassSize[] {
  return [...sizes].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export async function loadChartData(db: ScopedDb, schoolId: string, term: SummaryTerm) {
  const [levels, sizes] = await Promise.all([
    db.level.findMany({ where: { schoolId }, select: { id: true, name: true, order: true } }),
    loadClassSizes(db, schoolId, term),
  ]);
  const students = sizes.reduce((s, c) => s + c.count, 0);
  return { forms: enrolmentByForm(levels, sizes), classes: sortBySize(sizes), students };
}
