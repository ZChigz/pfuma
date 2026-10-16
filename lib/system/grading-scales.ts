// The pure part of grading scales (no database), so the Settings screen can use it too.
import type { LevelCategory } from '@prisma/client';

export interface ScaleRow {
  letterGrade: string;
  minPercent: number;
  maxPercent: number;
  points: number | null;
  remark: string | null;
}

export const CATEGORY_LABEL: Record<LevelCategory, string> = { O_LEVEL: 'O Level (Forms 1 to 4)', A_LEVEL: 'A Level (Forms 5 and 6)' };

/** The starting points. A school confirms or changes them; nothing is graded with them until it does. */
export const DEFAULT_SCALES: Record<LevelCategory, ScaleRow[]> = {
  O_LEVEL: [
    { letterGrade: 'A', minPercent: 75, maxPercent: 100, points: null, remark: 'Excellent' },
    { letterGrade: 'B', minPercent: 60, maxPercent: 74, points: null, remark: 'Very good' },
    { letterGrade: 'C', minPercent: 50, maxPercent: 59, points: null, remark: 'Good' },
    { letterGrade: 'D', minPercent: 40, maxPercent: 49, points: null, remark: 'Satisfactory' },
    { letterGrade: 'E', minPercent: 30, maxPercent: 39, points: null, remark: 'Weak' },
    { letterGrade: 'U', minPercent: 0, maxPercent: 29, points: null, remark: 'Ungraded' },
  ],
  A_LEVEL: [
    { letterGrade: 'A', minPercent: 80, maxPercent: 100, points: 5, remark: 'Excellent' },
    { letterGrade: 'B', minPercent: 70, maxPercent: 79, points: 4, remark: 'Very good' },
    { letterGrade: 'C', minPercent: 60, maxPercent: 69, points: 3, remark: 'Good' },
    { letterGrade: 'D', minPercent: 50, maxPercent: 59, points: 2, remark: 'Satisfactory' },
    { letterGrade: 'E', minPercent: 40, maxPercent: 49, points: 1, remark: 'Pass' },
    { letterGrade: 'U', minPercent: 0, maxPercent: 39, points: 0, remark: 'Ungraded' },
  ],
};

export type ScaleSource = 'saved' | 'school-wide' | 'default';
