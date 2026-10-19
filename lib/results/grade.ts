// Turning a rounded term mark into a grade, points and remark with the level's grading scale. The service copies the answer
// onto each result, so editing the scale later never changes a published grade.
import { gradeFor } from '@/lib/results/legacy';
import type { GradeResult, ScaleBand } from '@/lib/results/types';

export function gradeOf(roundedMark: number | null, scale: ScaleBand[]): GradeResult {
  if (roundedMark === null) return { grade: null, points: null, remark: null };
  const band = gradeFor(roundedMark, scale);
  return band ? { grade: band.letterGrade, points: band.points, remark: band.remark } : { grade: null, points: null, remark: null };
}

/**
 * The lowest mark that counts as a pass: where the school's pass grade (a setting, "C" by default) begins on the scale.
 * Falls back to 50 when the scale has no such grade.
 */
export function passMarkOf(scale: ScaleBand[], passGrade: string): number {
  return scale.find((b) => b.letterGrade === passGrade)?.minPercent ?? 50;
}

export interface SubjectOutcome { subjectId: string; roundedMark: number | null; points: number | null }

/** O Level: how many subjects were passed (the pass grade or better). */
export function countPasses(subjects: SubjectOutcome[], passMark: number): number {
  return subjects.filter((s) => s.roundedMark !== null && s.roundedMark >= passMark).length;
}

/**
 * O Level flag: "5 or more passes including English Language and Mathematics". Null when the school has not said which
 * subjects those are.
 */
export function fivePassesWithEnglishAndMaths(
  subjects: SubjectOutcome[],
  passMark: number,
  required: number,
  englishSubjectId: string | null,
  mathsSubjectId: string | null,
): boolean | null {
  if (!englishSubjectId || !mathsSubjectId) return null;
  const passed = (id: string) => subjects.some((s) => s.subjectId === id && s.roundedMark !== null && s.roundedMark >= passMark);
  return countPasses(subjects, passMark) >= required && passed(englishSubjectId) && passed(mathsSubjectId);
}

/** A Level: total points of the best three subjects (A = 5 ... E = 1, from the scale). Fewer than three subjects add what there is. */
export function aLevelPoints(subjects: SubjectOutcome[], best = 3): number {
  return subjects
    .map((s) => s.points ?? 0)
    .sort((a, b) => b - a)
    .slice(0, best)
    .reduce((a, b) => a + b, 0);
}
