// The rules of the year-end promotion that need no database: what each form proposes by default, which
// outcomes are possible from which form, and the review (new class sizes against capacity, who is leaving).
import type { ExitReason } from '@prisma/client';
import { classDisplayName } from '@/lib/academic/rules';

export const OUTCOMES = ['PROMOTE', 'REPEAT', 'MOVE_STREAM', 'CONTINUE_LOWER_6', 'OTHER_CLASS', 'COMPLETE', 'LEAVE'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  PROMOTE: 'Move up', REPEAT: 'Repeat', MOVE_STREAM: 'Move up to another stream', CONTINUE_LOWER_6: 'Continue to Lower 6', OTHER_CLASS: 'Another class',
  COMPLETE: 'Completed', LEAVE: 'Leave',
};

/** Reasons a student can leave at year end other than completing O or A Level (those are the COMPLETE outcome). */
export const LEAVE_REASONS = ['TRANSFER', 'WITHDRAWN_BY_GUARDIAN', 'RELOCATED_ABROAD', 'DECEASED', 'OTHER'] as const satisfies readonly ExitReason[];

/** Form 4 completes O Level, Form 6 (Upper 6) completes A Level; every other form moves up (Lower 6 → Upper 6). */
export const defaultOutcome = (levelOrder: number): 'PROMOTE' | 'COMPLETE' => (levelOrder === 4 || levelOrder === 6 ? 'COMPLETE' : 'PROMOTE');
export const completionReason = (levelOrder: number): ExitReason => (levelOrder >= 6 ? 'COMPLETED_A_LEVEL' : 'COMPLETED_O_LEVEL');

/** The class a student would normally go to: the next form, same stream (Form 2 East → Form 3 East). */
export const proposedClassName = (levelOrder: number, stream: string) => classDisplayName(`Form ${levelOrder + 1}`, stream);

export interface PromotionClass { id: string; name: string; levelOrder: number; stream: string; capacity: number; active: boolean }

export interface PromotionLine {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  fromClassId: string;
  fromClassName: string;
  fromLevel: number;
  fromStream: string;
  outcome: Outcome;
  /** The class they go to, when it already exists. */
  toClassId: string | null;
  /** Its name; when toClassId is null the class is created on confirmation. */
  toClassName: string | null;
  /** For LEAVE and COMPLETE. */
  exitReason: ExitReason | null;
  note: string | null;
}

/** The level a student must land in for an outcome, or null when any level goes (or there is no class). */
export function targetLevel(outcome: Outcome, fromLevel: number): number | null {
  switch (outcome) {
    case 'PROMOTE': case 'MOVE_STREAM': return fromLevel + 1;
    case 'REPEAT': return fromLevel;
    case 'CONTINUE_LOWER_6': return 5;
    default: return null;
  }
}

/** Why a decision cannot stand, or null. Used when a draft is saved and again at confirmation. */
export function lineProblem(line: PromotionLine, classes: ReadonlyMap<string, PromotionClass>): string | null {
  const who = line.fullName;
  const { outcome, fromLevel } = line;
  if ((outcome === 'PROMOTE' || outcome === 'MOVE_STREAM') && (fromLevel === 4 || fromLevel >= 6)) {
    return fromLevel === 4 ? `${who}: Form 4 students complete O Level or continue to Lower 6` : `${who}: Upper 6 students complete A Level`;
  }
  if (outcome === 'CONTINUE_LOWER_6' && fromLevel !== 4) return `${who}: only Form 4 students continue to Lower 6`;
  if (outcome === 'COMPLETE' && fromLevel !== 4 && fromLevel !== 6) return `${who}: only Form 4 and Upper 6 students complete a level`;
  if (outcome === 'LEAVE') {
    if (!line.exitReason || !(LEAVE_REASONS as readonly string[]).includes(line.exitReason)) return `${who}: choose why the student is leaving`;
    if (line.exitReason === 'OTHER' && !line.note) return `${who}: say what the reason is`;
    return null;
  }
  if (outcome === 'COMPLETE') return null;
  if (outcome === 'MOVE_STREAM' || outcome === 'OTHER_CLASS') {
    const klass = line.toClassId ? classes.get(line.toClassId) : null;
    if (!klass) return `${who}: choose the class`;
    if (!klass.active) return `${who}: ${klass.name} is not in use`;
    if (outcome === 'MOVE_STREAM' && klass.levelOrder !== fromLevel + 1) return `${who}: ${klass.name} is not a Form ${fromLevel + 1} class`;
    if (outcome === 'MOVE_STREAM' && klass.stream.toLowerCase() === line.fromStream.toLowerCase()) return `${who}: choose a different stream, or use Move up`;
    return null;
  }
  if (line.toClassId) {
    const klass = classes.get(line.toClassId);
    if (!klass) return `${who}: class not found`;
    if (!klass.active) return `${who}: ${klass.name} is not in use`;
    const want = targetLevel(outcome, fromLevel);
    if (want !== null && klass.levelOrder !== want) return `${who}: ${klass.name} is not a Form ${want} class`;
  }
  return null;
}

export interface ClassReview { classId: string | null; className: string; willBeCreated: boolean; incoming: number; capacity: number | null; overBy: number }
export interface PromotionReview {
  perClass: ClassReview[];
  leavers: { studentId: string; fullName: string; fromClassName: string; outcome: Outcome; exitReason: ExitReason }[];
  counts: Record<Outcome, number>;
  exceptions: number;
  overCapacity: ClassReview[];
}

/** An exception is anything other than the default for the student's form. */
export const isException = (line: Pick<PromotionLine, 'outcome' | 'fromLevel'>) => line.outcome !== defaultOutcome(line.fromLevel);

/** Step 4: counts per new class against capacity, and everyone who is leaving. */
export function reviewLines(lines: PromotionLine[], classes: ReadonlyMap<string, PromotionClass>, defaultCapacity = 45): PromotionReview {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  const slots = new Map<string, ClassReview>();
  const leavers: PromotionReview['leavers'] = [];
  for (const l of lines) {
    counts[l.outcome]++;
    if (l.outcome === 'LEAVE' || l.outcome === 'COMPLETE') {
      leavers.push({ studentId: l.studentId, fullName: l.fullName, fromClassName: l.fromClassName, outcome: l.outcome, exitReason: l.exitReason ?? completionReason(l.fromLevel) });
      continue;
    }
    const name = l.outcome === 'REPEAT' ? l.fromClassName : l.toClassName ?? classes.get(l.toClassId ?? '')?.name ?? proposedClassName(l.fromLevel, l.fromStream);
    const klass = l.toClassId ? classes.get(l.toClassId) : l.outcome === 'REPEAT' ? classes.get(l.fromClassId) : undefined;
    const key = klass?.id ?? `new:${name.toLowerCase()}`;
    const slot = slots.get(key) ?? { classId: klass?.id ?? null, className: klass?.name ?? name, willBeCreated: !klass, incoming: 0, capacity: klass?.capacity ?? defaultCapacity, overBy: 0 };
    slot.incoming++;
    slots.set(key, slot);
  }
  const perClass = Array.from(slots.values()).map((s) => ({ ...s, overBy: Math.max(0, s.incoming - (s.capacity ?? defaultCapacity)) }));
  perClass.sort((a, b) => a.className.localeCompare(b.className, 'en', { numeric: true }));
  return { perClass, leavers, counts, exceptions: lines.filter(isException).length, overCapacity: perClass.filter((c) => c.overBy > 0) };
}
