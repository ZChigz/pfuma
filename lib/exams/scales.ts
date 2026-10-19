// The grading scale and the plan that apply to a subject at a level in a term. Looked up here so the mark grid, the
// verification screen and the stored results all grade with the same rows.
import type { LevelCategory } from '@prisma/client';
import type { Db } from '@/lib/scoped-db';
import { boundariesFor, passMarkOf, type ScaleBand } from '@/lib/results';
import { DEFAULT_SCALES } from '@/lib/system/grading-scales';
import { resolvePlan, type PlanView } from '@/lib/exams/setup';

export interface LevelScale { scale: ScaleBand[]; passGrade: string; passMark: number; category: LevelCategory }

/**
 * The most specific boundary set for the level and term: the level's own, then the scale chosen in Settings for its category
 * (O Level or A Level), then the school-wide set, then the starting scale. The school's pass grade ("C") sets the pass mark.
 */
export async function scaleFor(tx: Db, schoolId: string, levelId: string, termId: string): Promise<LevelScale> {
  const [level, rows, school] = await Promise.all([
    tx.level.findFirst({ where: { id: levelId, schoolId }, select: { category: true } }),
    tx.gradeBoundary.findMany({ where: { schoolId } }),
    tx.school.findUnique({ where: { id: schoolId }, select: { passGrade: true } }),
  ]);
  const category = level?.category ?? 'O_LEVEL';
  const picked = boundariesFor(
    rows.map((r) => ({ ...r, minPercent: r.minPercent.toNumber(), maxPercent: r.maxPercent.toNumber(), category: r.category })),
    levelId, termId, category,
  );
  const scale: ScaleBand[] = picked.length
    ? picked.map((r) => ({ letterGrade: r.letterGrade, minPercent: r.minPercent, maxPercent: r.maxPercent, points: r.points, remark: r.remark }))
    : DEFAULT_SCALES[category];
  const passGrade = school?.passGrade ?? 'C';
  return { scale: [...scale].sort((a, b) => b.minPercent - a.minPercent), passGrade, passMark: passMarkOf(scale, passGrade), category };
}

export interface PlanAndScale { plan: PlanView | null; scale: LevelScale }

export async function planAndScale(tx: Db, schoolId: string, termId: string, levelId: string, subjectId: string): Promise<PlanAndScale> {
  const [plan, scale] = await Promise.all([resolvePlan(tx, schoolId, termId, levelId, subjectId), scaleFor(tx, schoolId, levelId, termId)]);
  return { plan, scale };
}

