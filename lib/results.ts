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

/** Rounds to 2 decimal places without binary floating-point noise (1.005 -> 1.01). */
export const round2 = (n: number) => Number(Math.round(Number(`${n}e2`)) + 'e-2');

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

// ─── Grade boundaries ────────────────────────────────────────────────────────

export interface BoundaryRow {
  minPercent: number;
  maxPercent: number;
  letterGrade: string;
  levelId?: string | null;
  termId?: string | null;
}

/**
 * The boundary set for a level and term: the most specific non-empty set wins —
 * level + term, then level, then term, then the school-wide set.
 */
export function boundariesFor<T extends BoundaryRow>(rows: T[], levelId: string | null, termId: string | null): T[] {
  const pick = (l: string | null, t: string | null) => rows.filter((r) => (r.levelId ?? null) === l && (r.termId ?? null) === t);
  const tries: [string | null, string | null][] = [[levelId, termId], [levelId, null], [null, termId], [null, null]];
  for (const [l, t] of tries) {
    const set = pick(l, t);
    if (set.length > 0) return set;
  }
  return [];
}

/**
 * A set must start at 0, end at 100, not overlap and leave no gaps. Marks are
 * percentages with decimals, so a band belongs to the lowest mark it starts at:
 * the next band may start 1 point (whole-number bands: 70–79, 80–100) or 0.01
 * (70–79.99, 80–100) above the previous maximum.
 */
export function validateBoundaries(rows: { minPercent: number; maxPercent: number; letterGrade: string }[]): string | null {
  if (rows.length === 0) return 'At least one boundary is required';
  for (const r of rows) {
    if (!(r.minPercent >= 0 && r.maxPercent <= 100)) return 'Values must be between 0 and 100';
    if (r.minPercent > r.maxPercent) return `${r.letterGrade}: min % must not be above max %`;
    if (!r.letterGrade.trim()) return 'Letter grade cannot be empty';
  }
  const letters = rows.map((r) => r.letterGrade.trim().toLowerCase());
  if (new Set(letters).size !== letters.length) return 'Each letter grade can only be used once';
  const sorted = [...rows].sort((x, y) => x.minPercent - y.minPercent);
  if (sorted[0].minPercent !== 0) return `The lowest range must start at 0% (it starts at ${sorted[0].minPercent}%)`;
  if (sorted[sorted.length - 1].maxPercent !== 100) return `The highest range must end at 100% (it ends at ${sorted[sorted.length - 1].maxPercent}%)`;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.minPercent <= prev.maxPercent) return `Ranges overlap: ${prev.letterGrade} (${prev.minPercent}–${prev.maxPercent}%) and ${cur.letterGrade} (${cur.minPercent}–${cur.maxPercent}%)`;
    const step = round2(cur.minPercent - prev.maxPercent);
    if (step !== 1 && step !== 0.01) return `Gap between ${prev.maxPercent}% and ${cur.minPercent}%`;
  }
  return null;
}

/** The boundary a percentage falls in: the highest band whose minimum it reaches. */
export function gradeFor<T extends BoundaryRow>(percentage: number, boundaries: T[]): T | null {
  let best: T | null = null;
  for (const b of boundaries) {
    if (percentage >= b.minPercent && (best === null || b.minPercent > best.minPercent)) best = b;
  }
  return best;
}

export function getLetterGrade(percentage: number, boundaries: BoundaryRow[]): string | null {
  return gradeFor(percentage, boundaries)?.letterGrade ?? null;
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
