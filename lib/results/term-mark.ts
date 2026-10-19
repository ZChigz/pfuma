// The subject term mark: the one place where marks become a percentage. Every screen, the report card, analytics and the
// exports call this, so they always agree.
//
//   each assessment -> percentage (mark / maximum x 100)
//   assessments of a plan line -> one score by the line's rule (average, best N, or weighted by maximum mark)
//   term mark = sum(weight x line score) / sum(weight of the lines that count)
//
// AB (absent) and NS (not submitted) count as 0. EX (exempt) and AB_EXCUSED (absence the Head excused) are left out, and
// the weights that remain are scaled up to 100% for that student. Stored to 2 decimal places, shown rounded to a whole number.
import { round2 } from '@/lib/results/legacy';
import type { AssessmentInput, Entry, LineScore, MarkInput, PlanLine, TermMarkResult } from '@/lib/results/types';

/** Rounds a stored 2-decimal term mark to the whole number that is shown and graded (62.5 -> 63). */
export const roundMark = (termMark: number): number => Math.floor(round2(termMark) + 0.5);

/** One mark of an ordinary assessment as an entry in the calculation. */
export function entryOf(a: AssessmentInput, mark: MarkInput | undefined): Entry {
  const base = { assessmentId: a.id, typeId: a.typeId, possible: a.maxMark };
  if (!mark || (mark.value === null && mark.code === null)) return { ...base, state: 'MISSING', earned: 0 };
  if (mark.value !== null) return { ...base, state: 'SCORED', earned: mark.value };
  if (mark.code === 'AB' || mark.code === 'NS') return { ...base, state: 'ZERO', earned: 0 };
  return { ...base, state: 'LEFT_OUT', earned: 0 }; // EX, AB_EXCUSED
}

export interface StageInput { maxMark: number; value: number | null; code: MarkInput['code'] }

/**
 * A school-based project is marked stage by stage; its total feeds the plan like any other assessment. A stage that is
 * exempt or excused is left out of both the marks and the maximum; a project with every stage left out is left out.
 */
export function projectEntry(a: AssessmentInput, stages: StageInput[]): Entry {
  let earned = 0;
  let possible = 0;
  let missing = false;
  let counted = 0;
  for (const s of stages) {
    if (s.value === null && s.code === null) { missing = true; continue; }
    if (s.code === 'EX' || s.code === 'AB_EXCUSED') continue;
    counted++;
    possible += s.maxMark;
    earned += s.value ?? 0; // AB and NS add nothing
  }
  const base = { assessmentId: a.id, typeId: a.typeId };
  if (counted === 0) return { ...base, state: missing ? 'MISSING' : 'LEFT_OUT', earned: 0, possible: a.maxMark };
  return { ...base, state: missing ? 'MISSING' : 'SCORED', earned, possible };
}

const pct = (e: Entry) => (e.possible > 0 ? (e.earned / e.possible) * 100 : 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The score of one plan line (0-100) from the entries of its types, or null when none of them counts. */
export function lineScore(line: PlanLine, entries: Entry[]): { score: number | null; counted: number; incomplete: boolean } {
  const mine = entries.filter((e) => line.typeIds.includes(e.typeId));
  const incomplete = mine.some((e) => e.state === 'MISSING');
  const counting = mine.filter((e) => e.state === 'SCORED' || e.state === 'ZERO');
  if (counting.length === 0) return { score: null, counted: 0, incomplete };
  let score: number;
  if (line.rule === 'BY_MAX') {
    const possible = counting.reduce((a, e) => a + e.possible, 0);
    score = possible > 0 ? (counting.reduce((a, e) => a + e.earned, 0) / possible) * 100 : 0;
  } else if (line.rule === 'BEST_N') {
    const n = Math.max(1, line.bestN ?? counting.length);
    score = mean(counting.map(pct).sort((x, y) => y - x).slice(0, n));
  } else {
    score = mean(counting.map(pct));
  }
  return { score, counted: counting.length, incomplete };
}

/**
 * The term mark for one student in one subject.
 * `entries` holds one entry per assessment that counts to the term (build them with entryOf / projectEntry).
 */
export function calculateTermMark(plan: PlanLine[], entries: Entry[]): TermMarkResult {
  const lines: LineScore[] = [];
  const leftOut: string[] = [];
  let incomplete = false;
  let weighted = 0;
  let weights = 0;
  for (const line of plan) {
    const r = lineScore(line, entries);
    incomplete ||= r.incomplete;
    lines.push({ key: line.key, label: line.label, weight: line.weight, score: r.score === null ? null : round2(r.score), counted: r.counted });
    if (r.score === null) { leftOut.push(line.label); continue; }
    weighted += line.weight * r.score;
    weights += line.weight;
  }
  if (weights === 0) return { termMark: null, roundedMark: null, lines, leftOutLines: leftOut, incomplete };
  const termMark = round2(weighted / weights);
  return { termMark, roundedMark: roundMark(termMark), lines, leftOutLines: leftOut, incomplete };
}

/** Entries for one student from the assessments of the plan (those that count) and their marks. */
export function entriesFor(assessments: AssessmentInput[], marks: Map<string, MarkInput>, projectStages?: Map<string, StageInput[]>): Entry[] {
  return assessments
    .filter((a) => a.countsToTerm)
    .map((a) => (projectStages?.has(a.id) ? projectEntry(a, projectStages.get(a.id)!) : entryOf(a, marks.get(a.id))));
}

/** Checks a plan before it is saved: weights add up to 100, every type is used once, BEST_N has a count. Returns the problem or null. */
export function validatePlan(lines: { label: string; weight: number; rule: PlanLine['rule']; bestN?: number | null; typeIds: string[] }[]): string | null {
  if (lines.length === 0) return 'A plan needs at least one line';
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.label.trim()) return 'Every line needs a name';
    if (!(l.weight > 0 && l.weight <= 100)) return `${l.label}: the weight must be above 0 and at most 100`;
    if (l.typeIds.length === 0) return `${l.label}: choose at least one assessment type`;
    if (l.rule === 'BEST_N' && !(Number.isInteger(l.bestN) && (l.bestN ?? 0) >= 1)) return `${l.label}: enter how many of the best assessments count`;
    for (const t of l.typeIds) {
      if (seen.has(t)) return `${l.label}: an assessment type can only be on one line`;
      seen.add(t);
    }
  }
  const total = round2(lines.reduce((a, l) => a + l.weight, 0));
  if (total !== 100) return `The weights add up to ${total}%, not 100%`;
  return null;
}
