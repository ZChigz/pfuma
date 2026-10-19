// The first results screens (teacher/marks, head/results, /api/results/*) and the Examinations module both end in TermResult rows.
// Once a school has set a weighting plan for a form in a term, that term is run from Examinations, and the older screens step aside
// for it so the two never write the same results. (The plan the migration makes for imported marks does not count.)
import type { ScopedDb } from '@/lib/scoped-db';

export const LEGACY_MESSAGE = 'This form is run from Examinations this term (a weighting plan has been set), so marks and results are entered and published there.';

export async function newExamsActive(db: Pick<ScopedDb, 'weightingPlan'>, schoolId: string, levelId: string, termId: string): Promise<boolean> {
  return (await db.weightingPlan.count({ where: { schoolId, levelId, termId, name: { not: 'Imported marks' } } })) > 0;
}
