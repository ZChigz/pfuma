// Shapes shared by the results calculations. Plain numbers and strings only: nothing here touches the database.

export type MarkCode = 'AB' | 'EX' | 'NS' | 'AB_EXCUSED';
export type CombineRule = 'AVERAGE' | 'BEST_N' | 'BY_MAX';

/** One line of a weighting plan: "Class tests and assignments, 20%, average of all". */
export interface PlanLine {
  key: string;
  label: string;
  /** Percent of the term mark (the lines of a plan add up to 100). */
  weight: number;
  rule: CombineRule;
  bestN: number | null;
  /** The assessment types combined on this line. */
  typeIds: string[];
}

export interface AssessmentInput {
  id: string;
  typeId: string;
  maxMark: number;
  countsToTerm: boolean;
}

/** What a student has for one assessment: a number, a code, or (both null) nothing entered yet. */
export interface MarkInput {
  assessmentId: string;
  value: number | null;
  code: MarkCode | null;
}

/**
 * How one mark takes part in a line score.
 *  SCORED   marks earned out of the maximum
 *  ZERO     absent (not excused) or not submitted: counts as 0 out of the maximum
 *  LEFT_OUT exempt or absence excused by the Head: not in the average at all
 *  MISSING  nothing entered yet: left out, and the result is flagged incomplete
 */
export type EntryState = 'SCORED' | 'ZERO' | 'LEFT_OUT' | 'MISSING';

export interface Entry {
  assessmentId: string;
  typeId: string;
  state: EntryState;
  earned: number;
  possible: number;
}

export interface LineScore {
  key: string;
  label: string;
  weight: number;
  /** Percentage 0-100, or null when nothing on this line counts for the student. */
  score: number | null;
  /** How many assessments went into the score. */
  counted: number;
}

export interface TermMarkResult {
  /** Stored to 2 decimal places; null when nothing counts at all (every assessment exempt). */
  termMark: number | null;
  /** The mark shown and graded: termMark rounded to a whole number. */
  roundedMark: number | null;
  lines: LineScore[];
  /** Lines left out of this student's mark (nothing counted), so the other weights were scaled up. */
  leftOutLines: string[];
  /** True when a counted assessment had nothing entered. */
  incomplete: boolean;
}

export interface ScaleBand {
  letterGrade: string;
  minPercent: number;
  maxPercent: number;
  points: number | null;
  remark: string | null;
}

export interface GradeResult {
  grade: string | null;
  points: number | null;
  remark: string | null;
}
