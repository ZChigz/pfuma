import type { AssignmentMarkStatus, MarkStatus } from '@/types';

// ─── Fair ranking ────────────────────────────────────────────────────────────
//
// Students in one class do not always sit the same papers: some take different
// electives, some miss an exam. Ranking by total marks would put them at an
// unfair disadvantage, so:
//
//   • A student's score is their AVERAGE PERCENTAGE over the subjects they
//     actually sat (sum of marks ÷ sum of maximum marks of those subjects).
//     A subject with no mark is "not sat" — it is left out, not counted as 0.
//     An entered 0 is a real zero.
//   • Only students who sat enough subjects are ranked: at least half (rounded
//     up) of the CORE subjects offered to the class, or of all subjects when the
//     class has no core subject. Others get no position, so a student who sat a
//     single paper cannot come top (or bottom) of the class on one result.
//   • Ties share a position and the next position is skipped (1, 2, 2, 4).
//     Percentages are compared to two decimals so rounding noise cannot split a tie.

export const MIN_RANKING_COVERAGE = 0.5;

export interface OfferedSubject { id: string; maxMark: number; core: boolean }
export interface SatMark { subjectId: string; rawMark: number }

export interface StudentSummary {
  totalMarks: number;      // sum of marks in the subjects sat
  totalPossible: number;   // sum of the maximum marks of those subjects
  percentage: number;      // 0–100, average over the subjects sat
  subjectsSat: number;
  subjectsOffered: number;
  ranked: boolean;
}

/** How many subjects a student must have sat to be ranked in a class offering these subjects. */
export function requiredSubjects(offered: OfferedSubject[]): number {
  const core = offered.filter((s) => s.core);
  const pool = core.length > 0 ? core : offered;
  return Math.ceil(pool.length * MIN_RANKING_COVERAGE);
}

export function summariseStudent(marks: SatMark[], offered: OfferedSubject[]): StudentSummary {
  const byId = new Map(offered.map((s) => [s.id, s]));
  const sat = marks.filter((m) => byId.has(m.subjectId));
  const totalMarks = sat.reduce((n, m) => n + m.rawMark, 0);
  const totalPossible = sat.reduce((n, m) => n + (byId.get(m.subjectId)?.maxMark ?? 0), 0);
  const percentage = totalPossible > 0 ? (totalMarks / totalPossible) * 100 : 0;

  const corePool = offered.some((s) => s.core) ? offered.filter((s) => s.core) : offered;
  const coreIds = new Set(corePool.map((s) => s.id));
  const coreSat = sat.filter((m) => coreIds.has(m.subjectId)).length;
  const ranked = sat.length > 0 && coreSat >= requiredSubjects(offered);

  return { totalMarks, totalPossible, percentage, subjectsSat: sat.length, subjectsOffered: offered.length, ranked };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Position for every RANKED student (by percentage, ties share). Unranked students are absent from the map. */
export function assignPositions(
  students: { id: string; percentage: number; ranked: boolean }[],
): Map<string, number> {
  const ranked = students.filter((s) => s.ranked).sort((a, b) => round2(b.percentage) - round2(a.percentage));
  const positions = new Map<string, number>();
  let current = 1;
  for (let i = 0; i < ranked.length; i++) {
    if (i > 0 && round2(ranked[i].percentage) < round2(ranked[i - 1].percentage)) current = i + 1;
    positions.set(ranked[i].id, current);
  }
  return positions;
}

export function getLetterGrade(
  percentage: number,
  boundaries: { minPercent: number; maxPercent: number; letterGrade: string }[],
): string | null {
  const boundary = boundaries.find((b) => percentage >= b.minPercent && percentage <= b.maxPercent);
  return boundary?.letterGrade ?? null;
}

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentMarkStatus, string> = {
  NOT_STARTED: 'NOT STARTED',
  IN_PROGRESS: 'IN PROGRESS',
  VERIFIED:    'VERIFIED',
  PUBLISHED:   'PUBLISHED',
};

export const MARK_STATUS_LABELS: Record<MarkStatus, string> = {
  DRAFT:     'DRAFT',
  VERIFIED:  'VERIFIED',
  PUBLISHED: 'PUBLISHED',
};
