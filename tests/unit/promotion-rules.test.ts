import { describe, expect, it } from 'vitest';
import {
  completionReason, defaultOutcome, isException, lineProblem, proposedClassName, reviewLines, type PromotionClass, type PromotionLine,
} from '@/lib/students/promotion-rules';

const cls = (id: string, levelOrder: number, stream: string, capacity = 45, active = true): PromotionClass => ({ id, name: `Form ${levelOrder} ${stream}`, levelOrder, stream, capacity, active });
const classes = new Map([cls('f1n', 1, 'North'), cls('f2n', 2, 'North'), cls('f2e', 2, 'East'), cls('f3n', 3, 'North'), cls('f4n', 4, 'North'), cls('f5a', 5, 'Arts'), cls('f6a', 6, 'Arts'), cls('f3x', 3, 'Closed', 45, false)].map((c) => [c.id, c]));

const line = (over: Partial<PromotionLine> & { fromLevel: number }): PromotionLine => ({
  studentId: 's', fullName: 'Tendai Moyo', admissionNumber: 'A1', fromClassId: `f${over.fromLevel}n`, fromClassName: `Form ${over.fromLevel} North`, fromStream: 'North',
  outcome: 'PROMOTE', toClassId: null, toClassName: null, exitReason: null, note: null, ...over,
});

describe('what each form proposes', () => {
  it('moves Forms 1, 2, 3 and Lower 6 up, and completes Form 4 and Upper 6', () => {
    expect([1, 2, 3, 4, 5, 6].map(defaultOutcome)).toEqual(['PROMOTE', 'PROMOTE', 'PROMOTE', 'COMPLETE', 'PROMOTE', 'COMPLETE']);
  });

  it('gives the reason that fits: O Level after Form 4, A Level after Upper 6', () => {
    expect(completionReason(4)).toBe('COMPLETED_O_LEVEL');
    expect(completionReason(6)).toBe('COMPLETED_A_LEVEL');
  });

  it('keeps the stream (Form 2 East → Form 3 East)', () => {
    expect(proposedClassName(2, 'East')).toBe('Form 3 East');
    expect(proposedClassName(5, 'Arts')).toBe('Form 6 Arts');
    expect(proposedClassName(1, '')).toBe('Form 2');
  });

  it('counts only decisions that differ from the proposal as exceptions', () => {
    expect(isException({ fromLevel: 2, outcome: 'PROMOTE' })).toBe(false);
    expect(isException({ fromLevel: 2, outcome: 'REPEAT' })).toBe(true);
    expect(isException({ fromLevel: 4, outcome: 'COMPLETE' })).toBe(false);
    expect(isException({ fromLevel: 4, outcome: 'CONTINUE_LOWER_6' })).toBe(true);
  });
});

describe('which decisions are possible', () => {
  const p = (l: PromotionLine) => lineProblem(l, classes);

  it('lets a form 1 to 3 student move up, repeat, change stream or leave', () => {
    expect(p(line({ fromLevel: 2, outcome: 'PROMOTE' }))).toBeNull();
    expect(p(line({ fromLevel: 2, outcome: 'REPEAT', toClassId: 'f2n' }))).toBeNull();
    expect(p(line({ fromLevel: 2, fromStream: 'North', fromClassId: 'f2n', outcome: 'MOVE_STREAM', toClassId: 'f3n' }))).toMatch(/different stream/);
    expect(p(line({ fromLevel: 1, outcome: 'LEAVE', exitReason: 'TRANSFER' }))).toBeNull();
  });

  it('sends Form 4 to completion or Lower 6, never to Form 5 by a plain promotion', () => {
    expect(p(line({ fromLevel: 4, outcome: 'COMPLETE', exitReason: 'COMPLETED_O_LEVEL' }))).toBeNull();
    expect(p(line({ fromLevel: 4, outcome: 'CONTINUE_LOWER_6', toClassId: 'f5a' }))).toBeNull();
    expect(p(line({ fromLevel: 4, outcome: 'PROMOTE' }))).toMatch(/complete O Level or continue to Lower 6/);
    expect(p(line({ fromLevel: 3, outcome: 'CONTINUE_LOWER_6' }))).toMatch(/only Form 4/);
  });

  it('lets only Form 4 and Upper 6 complete a level, and gives Upper 6 nowhere to go up to', () => {
    expect(p(line({ fromLevel: 2, outcome: 'COMPLETE' }))).toMatch(/only Form 4 and Upper 6/);
    expect(p(line({ fromLevel: 6, outcome: 'COMPLETE', exitReason: 'COMPLETED_A_LEVEL' }))).toBeNull();
    expect(p(line({ fromLevel: 6, outcome: 'PROMOTE' }))).toMatch(/Upper 6/);
  });

  it('wants a class for another stream or any other class, and that class must be in use and the right form', () => {
    expect(p(line({ fromLevel: 1, outcome: 'MOVE_STREAM' }))).toMatch(/choose the class/);
    expect(p(line({ fromLevel: 1, outcome: 'MOVE_STREAM', toClassId: 'f2e' }))).toBeNull();
    expect(p(line({ fromLevel: 1, outcome: 'MOVE_STREAM', toClassId: 'f3n' }))).toMatch(/not a Form 2 class/);
    expect(p(line({ fromLevel: 2, outcome: 'OTHER_CLASS', toClassId: 'f3x' }))).toMatch(/not in use/);
    expect(p(line({ fromLevel: 2, outcome: 'OTHER_CLASS', toClassId: 'nope' }))).toMatch(/choose the class/);
    expect(p(line({ fromLevel: 2, outcome: 'OTHER_CLASS', toClassId: 'f5a' }))).toBeNull();
  });

  it('needs a reason for leaving, and words when the reason is Other', () => {
    expect(p(line({ fromLevel: 2, outcome: 'LEAVE' }))).toMatch(/why/);
    expect(p(line({ fromLevel: 2, outcome: 'LEAVE', exitReason: 'COMPLETED_O_LEVEL' }))).toMatch(/why/); // completing is its own outcome
    expect(p(line({ fromLevel: 2, outcome: 'LEAVE', exitReason: 'OTHER' }))).toMatch(/say what/);
    expect(p(line({ fromLevel: 2, outcome: 'LEAVE', exitReason: 'OTHER', note: 'Family emergency' }))).toBeNull();
  });
});

describe('the review', () => {
  it('counts students per new class against capacity, creating the classes that do not exist', () => {
    const lines = [
      line({ studentId: '1', fromLevel: 1, toClassId: 'f2n', toClassName: 'Form 2 North' }),
      line({ studentId: '2', fromLevel: 1, toClassId: 'f2n', toClassName: 'Form 2 North' }),
      line({ studentId: '3', fromLevel: 2, fromStream: 'East', fromClassId: 'f2e', fromClassName: 'Form 2 East', toClassName: 'Form 3 East' }),
      line({ studentId: '4', fromLevel: 2, outcome: 'REPEAT', fromClassId: 'f2n', fromClassName: 'Form 2 North', toClassId: 'f2n', toClassName: 'Form 2 North' }),
    ];
    const r = reviewLines(lines, classes);
    expect(r.perClass.map((c) => [c.className, c.incoming, c.willBeCreated])).toEqual([['Form 2 North', 3, false], ['Form 3 East', 1, true]]);
    expect(r.overCapacity).toEqual([]);
    expect(r.counts).toMatchObject({ PROMOTE: 3, REPEAT: 1, LEAVE: 0 });
  });

  it('flags a class that would be over capacity, and says by how much', () => {
    const small = new Map([['f2n', cls('f2n', 2, 'North', 2)]]);
    const lines = [1, 2, 3, 4].map((i) => line({ studentId: String(i), fromLevel: 1, toClassId: 'f2n', toClassName: 'Form 2 North' }));
    const r = reviewLines(lines, small);
    expect(r.overCapacity).toMatchObject([{ className: 'Form 2 North', incoming: 4, capacity: 2, overBy: 2 }]);
  });

  it('lists everyone who is leaving with the reason', () => {
    const lines = [
      line({ studentId: '1', fromLevel: 4, outcome: 'COMPLETE', exitReason: 'COMPLETED_O_LEVEL', fullName: 'Ann Dube' }),
      line({ studentId: '2', fromLevel: 2, outcome: 'LEAVE', exitReason: 'TRANSFER', fullName: 'Ben Chari' }),
      line({ studentId: '3', fromLevel: 1, toClassId: 'f2n' }),
    ];
    const r = reviewLines(lines, classes);
    expect(r.leavers.map((l) => [l.fullName, l.exitReason])).toEqual([['Ann Dube', 'COMPLETED_O_LEVEL'], ['Ben Chari', 'TRANSFER']]);
    expect(r.exceptions).toBe(1); // only the transfer differs from the proposal
  });
});
