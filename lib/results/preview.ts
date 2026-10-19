// Term marks for a whole class from the marks as they stand now: the grid's last columns, the verification screen, and the
// calculation that is stored when a sheet is verified all use this one function. Pure: the browser calls it while a teacher
// types, the server calls it on the way to the database.
import { calculateTermMark, entryOf, projectEntry, type StageInput } from '@/lib/results/term-mark';
import { gradeOf } from '@/lib/results/grade';
import type { AssessmentInput, Entry, GradeResult, PlanLine, ScaleBand, TermMarkResult } from '@/lib/results/types';
import type { MarkCode } from '@/lib/results/types';

/** An assessment as the calculation sees it; a project lists its stages. */
export interface CalcAssessment extends AssessmentInput {
  stages?: { id: string; maxMark: number }[];
}

export interface StoredMark { value: number | null; code: MarkCode | null }

/** The key of a mark: student, assessment and (for a project) stage. The same key the grid and the offline queue use. */
export const markKey = (studentId: string, assessmentId: string, stageId?: string | null) => `${studentId}|${assessmentId}|${stageId ?? ''}`;

/** One student's entries for the assessments of the plan, from a lookup of marks. */
export function entriesForStudent(studentId: string, assessments: CalcAssessment[], marks: ReadonlyMap<string, StoredMark>): Entry[] {
  return assessments
    .filter((a) => a.countsToTerm)
    .map((a) => {
      if (a.stages) {
        const stages: StageInput[] = a.stages.map((s) => {
          const m = marks.get(markKey(studentId, a.id, s.id));
          return { maxMark: s.maxMark, value: m?.value ?? null, code: m?.code ?? null };
        });
        return projectEntry(a, stages);
      }
      const m = marks.get(markKey(studentId, a.id));
      return entryOf(a, m ? { assessmentId: a.id, value: m.value, code: m.code } : undefined);
    });
}

export type StudentPreview = TermMarkResult & GradeResult;

export function previewTermMarks(input: {
  plan: PlanLine[];
  scale: ScaleBand[];
  assessments: CalcAssessment[];
  marks: ReadonlyMap<string, StoredMark>;
  studentIds: string[];
}): Map<string, StudentPreview> {
  const out = new Map<string, StudentPreview>();
  for (const id of input.studentIds) {
    const r = calculateTermMark(input.plan, entriesForStudent(id, input.assessments, input.marks));
    out.set(id, { ...r, ...gradeOf(r.roundedMark, input.scale) });
  }
  return out;
}
