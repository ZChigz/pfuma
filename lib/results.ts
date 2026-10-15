import type { AssignmentMarkStatus, MarkStatus } from '@/types';

// ─── Fair ranking ────────────────────────────────────────────────────────────
//
// Students in one class do not always take the same subjects. So:
//
//   • Every enrolled student has a row for every subject (a score, ABSENT or
//     EXEMPT) — a subject cannot be verified otherwise.
//   • EXEMPT subjects are left out entirely. ABSENT counts as 0 % unless the
//     Head marked it excused, which leaves it out too.
//   • Overall percentage = the average of the student's per-subject percentages
//     over the subjects that count (not a raw total, and not divided by the
//     subjects offered to the class).
//   • A student is ranked only if enough of the class's CORE subjects count for
//     them (at least half, rounded up; all subjects when none is core).
//   • Ranking is by average percentage, or — for O Level classes when the school
//     chooses it — by number of subjects passed and then average percentage.
//   • Ties share a position and the next one is skipped (1, 2, 2, 4); values are
//     compared to two decimals.

export const MIN_RANKING_COVERAGE = 0.5;
export const DEFAULT_PASS_MARK = 50;

export type RankingMode = 'AVERAGE' | 'PASSES_THEN_AVERAGE';

export interface OfferedSubject { id: string; maxMark: number; core: boolean }
export interface MarkEntry {
  subjectId: string;
  rawMark: number;
  /** DRAFT / VERIFIED / PUBLISHED mean "has a score". */
  status?: 'DRAFT' | 'VERIFIED' | 'PUBLISHED' | 'ABSENT' | 'EXEMPT';
  excused?: boolean;
}

export interface StudentSummary {
  totalMarks: number;         // sum of the marks in the subjects that count (absent = 0)
  averagePercentage: number;  // 0–100
  subjectsTaken: number;      // subjects that count
  subjectsPassed: number;     // of those, at or above the pass mark
  subjectsOffered: number;
  ranked: boolean;
}

/** Lowest percentage that counts as a pass: the minimum of the pass grade's boundary. */
export function passThreshold(
  boundaries: { minPercent: number; letterGrade: string }[],
  passGrade: string,
): number {
  return boundaries.find((b) => b.letterGrade === passGrade)?.minPercent ?? DEFAULT_PASS_MARK;
}

const counts = (m: MarkEntry) => m.status !== 'EXEMPT' && !(m.status === 'ABSENT' && m.excused);

/** How many counted subjects a student needs, in a class offering these subjects, to be ranked. */
export function requiredSubjects(offered: OfferedSubject[]): number {
  const core = offered.filter((s) => s.core);
  const pool = core.length > 0 ? core : offered;
  return Math.ceil(pool.length * MIN_RANKING_COVERAGE);
}

export function summariseStudent(marks: MarkEntry[], offered: OfferedSubject[], passMark = DEFAULT_PASS_MARK): StudentSummary {
  const byId = new Map(offered.map((s) => [s.id, s]));
  const counted = marks.filter((m) => byId.has(m.subjectId) && counts(m));

  let totalMarks = 0;
  let percentSum = 0;
  let passed = 0;
  for (const m of counted) {
    const max = byId.get(m.subjectId)!.maxMark;
    const absent = m.status === 'ABSENT';
    const raw = absent ? 0 : m.rawMark;
    const pct = max > 0 ? (raw / max) * 100 : 0;
    totalMarks += raw;
    percentSum += pct;
    if (pct >= passMark) passed++;
  }
  const averagePercentage = counted.length > 0 ? percentSum / counted.length : 0;

  const corePool = offered.some((s) => s.core) ? offered.filter((s) => s.core) : offered;
  const coreIds = new Set(corePool.map((s) => s.id));
  const coreCounted = counted.filter((m) => coreIds.has(m.subjectId)).length;
  const ranked = counted.length > 0 && coreCounted >= requiredSubjects(offered);

  return { totalMarks, averagePercentage, subjectsTaken: counted.length, subjectsPassed: passed, subjectsOffered: offered.length, ranked };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Position for every RANKED student. Unranked students are absent from the map. */
export function assignPositions(
  students: { id: string; averagePercentage: number; subjectsPassed?: number; ranked: boolean }[],
  mode: RankingMode = 'AVERAGE',
): Map<string, number> {
  const key = (s: (typeof students)[number]) =>
    mode === 'PASSES_THEN_AVERAGE' ? [s.subjectsPassed ?? 0, round2(s.averagePercentage)] : [round2(s.averagePercentage)];
  const cmp = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  };
  const ranked = students.filter((s) => s.ranked).sort((a, b) => cmp(key(a), key(b)));
  const positions = new Map<string, number>();
  let current = 1;
  for (let i = 0; i < ranked.length; i++) {
    if (i > 0 && cmp(key(ranked[i]), key(ranked[i - 1])) !== 0) current = i + 1;
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
  ABSENT:    'ABSENT',
  EXEMPT:    'EXEMPT',
};
