// Grading scales (Settings tab 4): one for O Level, one for A Level. Each row is a grade with the
// lowest and highest percentage, points and a remark; the rows must cover 0 to 100 exactly.
import type { LevelCategory } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { ScopedDb } from '@/lib/scoped-db';
import { CATEGORY_LABEL, DEFAULT_SCALES, type ScaleRow, type ScaleSource } from '@/lib/system/grading-scales';

export { CATEGORY_LABEL, DEFAULT_SCALES };
export type { ScaleRow, ScaleSource };

type Actor = { id: string; schoolId: string };

export interface ScaleView { category: LevelCategory; source: ScaleSource; rows: ScaleRow[] }

type DbRow = { letterGrade: string; minPercent: { toNumber(): number }; maxPercent: { toNumber(): number }; points: number | null; remark: string | null };
const toRows = (rows: DbRow[]): ScaleRow[] =>
  rows
    .map((r) => ({ letterGrade: r.letterGrade, minPercent: r.minPercent.toNumber(), maxPercent: r.maxPercent.toNumber(), points: r.points, remark: r.remark }))
    .sort((a, b) => b.minPercent - a.minPercent);

/** What to show for a category: its saved scale; else the older school-wide set (still what grades marks); else the default. */
export async function getScales(db: ScopedDb, schoolId: string): Promise<ScaleView[]> {
  const all = await db.gradeBoundary.findMany({ where: { schoolId, levelId: null, termId: null } });
  const schoolWide = all.filter((r) => r.category === null);
  return (['O_LEVEL', 'A_LEVEL'] as const).map((category) => {
    const own = all.filter((r) => r.category === category);
    if (own.length > 0) return { category, source: 'saved' as const, rows: toRows(own) };
    if (schoolWide.length > 0) return { category, source: 'school-wide' as const, rows: toRows(schoolWide) };
    return { category, source: 'default' as const, rows: DEFAULT_SCALES[category] };
  });
}

const summary = (rows: ScaleRow[]) => rows.map((r) => `${r.letterGrade} ${r.minPercent}–${r.maxPercent}${r.points !== null ? ` (${r.points} pts)` : ''}`).join(', ');

export async function saveScale(db: ScopedDb, actor: Actor, category: LevelCategory, rows: ScaleRow[]) {
  // A Level grades earn points towards the university-entry total, so each needs them.
  if (category === 'A_LEVEL' && rows.some((r) => r.points === null || r.points === undefined)) {
    throw new ServiceError('Enter points for every A Level grade', 422);
  }
  const before = (await getScales(db, actor.schoolId)).find((s) => s.category === category)!;
  await db.$tx(async (tx) => {
    await tx.gradeBoundary.deleteMany({ where: { schoolId: actor.schoolId, category, levelId: null, termId: null } });
    await tx.gradeBoundary.createMany({
      data: rows.map((r) => ({
        schoolId: actor.schoolId, category, levelId: null, termId: null,
        letterGrade: r.letterGrade.trim(), minPercent: r.minPercent, maxPercent: r.maxPercent, points: r.points ?? null, remark: r.remark ?? null,
      })),
    });
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_GRADING', entityType: 'GradeBoundary', entityId: category,
        detail: `${CATEGORY_LABEL[category]}: ${summary(rows)}`,
        before: { source: before.source, scale: summary(before.rows) }, after: { source: 'saved', scale: summary(rows) },
      },
      tx,
    );
  });
  return (await getScales(db, actor.schoolId)).find((s) => s.category === category)!;
}
