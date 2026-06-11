import type { AssignmentMarkStatus, MarkStatus } from '@/types';

export const TERMS = ['Term 1, 2026', 'Term 2, 2026', 'Term 3, 2026'];

// Tie-aware ranking: equal totals share the same position, and the next
// distinct (lower) total resumes at its 1-based index rather than +1.
export function assignPositions(
  students: { id: string; totalMarks: number }[],
): Map<string, number> {
  const sorted = [...students].sort((a, b) => b.totalMarks - a.totalMarks);
  const positions = new Map<string, number>();
  let currentPosition = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].totalMarks < sorted[i - 1].totalMarks) {
      currentPosition = i + 1;
    }
    positions.set(sorted[i].id, currentPosition);
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
