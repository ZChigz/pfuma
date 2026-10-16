import { describe, expect, it } from 'vitest';
import { counterPattern, formatNumber, maxCounter, parseFormat, previewNumber } from '@/lib/numbering';
import { boundariesFor, gradeFor, validateBoundaries } from '@/lib/results';
import { DEFAULT_SCALES } from '@/lib/system/grading';
import { takeAdmissionNumber } from '@/lib/students/server';
import { formatAdmissionNumber } from '@/lib/students/registration';
import { ClassGridSchema, CreateYearSchema, FinanceSettingsSchema, FormsSchema, GradeScaleSchema, NumberingSchema, SchoolDefaultsSchema, StreamNameSchema, UpdateTermDatesSchema } from '@/lib/validations/system';

const ctx = { year: 2026, schoolCode: 'CHS' };

describe('number formats', () => {
  it('builds receipts, invoices and admission numbers', () => {
    expect(formatNumber('RCP-{YEAR}-{000000}', ctx, 14)).toBe('RCP-2026-000014');
    expect(formatNumber('{SCHOOLCODE}{YEAR}{0000}', ctx, 7)).toBe('CHS20260007');
    expect(formatNumber('INV/{YY}/{000}', ctx, 123)).toBe('INV/26/123');
    expect(formatNumber('{0}', ctx, 5)).toBe('5');
    expect(formatNumber('R {YEAR} - {0000}', ctx, 1)).toBe('R 2026 - 0001');
  });
  it('keeps the old admission numbers exactly as they were', () => {
    for (const n of [1, 14, 9999]) expect(formatNumber('{SCHOOLCODE}{YEAR}{0000}', { year: 2026, schoolCode: 'STU' }, n)).toBe(formatAdmissionNumber(2026, n));
  });
  it('refuses a number too big for the format', () => {
    expect(() => formatNumber('{000}', ctx, 1000)).toThrow(/does not fit/);
    expect(maxCounter('{SCHOOLCODE}{YEAR}{0000}')).toBe(9999);
    expect(maxCounter('nonsense')).toBe(0);
  });
  it('explains what is wrong with a bad format', () => {
    const bad = (f: string) => { const r = parseFormat(f); return r.ok ? null : r.error; };
    expect(bad('')).toMatch(/Enter a format/);
    expect(bad('RCP-{YEAR}')).toMatch(/running number/);
    expect(bad('{0000}{000}')).toMatch(/only once/);
    expect(bad('{COLOUR}-{0000}')).toMatch(/Unknown token/);
    expect(bad('A{0000')).toMatch(/not closed/);
    expect(bad('A}{0000}')).toMatch(/not closed|Unknown|Only letters/);
    expect(bad('RCP#{0000}')).toMatch(/Only letters/);
    expect(bad('<b>{0000}')).toMatch(/Only letters/);
    expect(bad('{00000000000}')).toMatch(/at most 10 digits/);
    expect(bad('x'.repeat(41) + '{0}')).toMatch(/40 characters/);
    expect(bad('RCP-{YEAR}-{000000}')).toBeNull();
  });
  it('previews, or says nothing when the format is wrong', () => {
    expect(previewNumber('RCP-{YEAR}-{000000}', ctx, 1)).toBe('RCP-2026-000001');
    expect(previewNumber('oops', ctx, 1)).toBeNull();
    expect(previewNumber('{00}', ctx, 100)).toBeNull();
  });
  it('recognises existing numbers of the format, to find the highest', () => {
    const p = counterPattern('{SCHOOLCODE}{YEAR}{0000}', ctx)!;
    expect(p.prefix).toBe('CHS2026');
    expect(p.regex.exec('CHS20260042')?.[1]).toBe('0042');
    expect(p.regex.exec('CHS20250042')).toBeNull();
    expect(p.regex.exec('STU20260042')).toBeNull();
    expect(p.regex.exec('CHS2026004')).toBeNull();
    const dotted = counterPattern('A.{YY}/{000}', ctx)!;
    expect(dotted.regex.exec('A.26/007')?.[1]).toBe('007');
    expect(dotted.regex.exec('AX26/007')).toBeNull(); // the dot is a dot, not "any character"
    expect(counterPattern('bad', ctx)).toBeNull();
  });
});

describe('admission numbers follow the format', () => {
  const withConfig = (format: string, code: string, start: number) => Object.assign(new Map([[2026, start]]), { config: { format, code } });
  it('use the school format and count on', () => {
    const seq = withConfig('{SCHOOLCODE}-{YY}-{000}', 'CHS', 14);
    expect(takeAdmissionNumber(seq, 2026)).toBe('CHS-26-014');
    expect(takeAdmissionNumber(seq, 2026)).toBe('CHS-26-015');
  });
  it('skip numbers already taken (supplied in an import)', () => {
    expect(takeAdmissionNumber(withConfig('{SCHOOLCODE}{YEAR}{0000}', 'STU', 1), 2026, new Set(['STU20260001', 'STU20260002']))).toBe('STU20260003');
  });
  it('still work with the plain map the older callers pass', () => {
    expect(takeAdmissionNumber(new Map([[2026, 5]]), 2026)).toBe('STU20260005');
  });
  it('stop with a helpful message when the numbers run out', () => {
    expect(() => takeAdmissionNumber(withConfig('{SCHOOLCODE}{0}', 'A', 10), 2026)).toThrow(/All 9 admission numbers/);
  });
});

describe('grading scales', () => {
  it('the defaults are the ones agreed, and valid', () => {
    expect(DEFAULT_SCALES.O_LEVEL.map((r) => `${r.letterGrade} ${r.minPercent}-${r.maxPercent}`)).toEqual(['A 75-100', 'B 60-74', 'C 50-59', 'D 40-49', 'E 30-39', 'U 0-29']);
    expect(DEFAULT_SCALES.A_LEVEL.filter((r) => r.letterGrade !== 'U').map((r) => `${r.letterGrade}=${r.points}`)).toEqual(['A=5', 'B=4', 'C=3', 'D=2', 'E=1']);
    for (const c of ['O_LEVEL', 'A_LEVEL'] as const) expect(validateBoundaries(DEFAULT_SCALES[c]), c).toBeNull();
  });
  it('accept a good scale and refuse gaps, overlaps and a scale that does not cover 0 to 100', () => {
    const rows = DEFAULT_SCALES.O_LEVEL.map((r) => ({ ...r }));
    expect(GradeScaleSchema.safeParse({ rows }).success).toBe(true);
    const with_ = (change: (r: typeof rows) => typeof rows) => GradeScaleSchema.safeParse({ rows: change(rows.map((r) => ({ ...r }))) });
    expect(with_((r) => { r[1].maxPercent = 72; return r; }).success).toBe(false);          // gap 72→75
    expect(with_((r) => { r[1].maxPercent = 76; return r; }).success).toBe(false);          // overlap
    expect(with_((r) => { r[5].minPercent = 5; return r; }).success).toBe(false);           // starts at 5
    expect(with_((r) => { r[0].maxPercent = 95; return r; }).success).toBe(false);          // ends at 95
    expect(with_((r) => { r[1].letterGrade = 'A'; return r; }).success).toBe(false);        // grade used twice
    expect(with_((r) => r.slice(0, 1)).success).toBe(false);
    expect(with_((r) => { r[0].minPercent = 101; return r; }).success).toBe(false);
  });
  it('check grade, points and remark', () => {
    const base = DEFAULT_SCALES.A_LEVEL.map((r) => ({ ...r }));
    const ok = (mut: (r: typeof base) => void) => { const r = base.map((x) => ({ ...x })); mut(r); return GradeScaleSchema.safeParse({ rows: r }).success; };
    expect(ok(() => {})).toBe(true);
    expect(ok((r) => { r[0].letterGrade = ''; })).toBe(false);
    expect(ok((r) => { r[0].letterGrade = 'ABCD'; })).toBe(false);
    expect(ok((r) => { r[0].points = -1; })).toBe(false);
    expect(ok((r) => { r[0].points = 1.5; })).toBe(false);
    expect(ok((r) => { r[0].remark = 'x'.repeat(61); })).toBe(false);
    expect(ok((r) => { r[0].remark = ''; })).toBe(true);
  });
  it('use the scale chosen for the category before the older school-wide one', () => {
    const band = (letter: string, min: number, max: number, extra: object = {}) => ({ letterGrade: letter, minPercent: min, maxPercent: max, ...extra });
    const schoolWide = [band('S', 0, 100)];
    const oLevel = [band('O', 0, 100, { category: 'O_LEVEL' as const })];
    const aLevel = [band('Z', 0, 100, { category: 'A_LEVEL' as const })];
    const levelSet = [band('L', 0, 100, { levelId: 'l1' })];
    const rows = [...schoolWide, ...oLevel, ...aLevel, ...levelSet];
    expect(gradeFor(50, boundariesFor(rows, 'l9', 't1', 'O_LEVEL'))?.letterGrade).toBe('O');
    expect(gradeFor(50, boundariesFor(rows, 'l9', 't1', 'A_LEVEL'))?.letterGrade).toBe('Z');
    expect(gradeFor(50, boundariesFor(rows, 'l1', 't1', 'O_LEVEL'))?.letterGrade).toBe('L'); // a set made for that form still wins
    expect(gradeFor(50, boundariesFor(rows, 'l9', 't1', null))?.letterGrade).toBe('S');
    expect(gradeFor(50, boundariesFor([...schoolWide, ...aLevel], 'l9', 't1', 'O_LEVEL'))?.letterGrade).toBe('S'); // no O Level scale: fall back
    expect(boundariesFor(oLevel, 'l9', 't1', null)).toEqual([]); // a category scale is never mistaken for the school-wide set
  });
});

describe('input rules (Zod)', () => {
  it('a year needs three terms inside it that do not overlap', () => {
    const terms = [
      { startDate: '2026-01-12', endDate: '2026-04-10' },
      { startDate: '2026-05-04', endDate: '2026-08-14' },
      { startDate: '2026-09-07', endDate: '2026-12-04' },
    ];
    const check = (t: object[], year = 2026) => CreateYearSchema.safeParse({ year, terms: t });
    expect(check(terms).success).toBe(true);
    expect(check(terms.slice(0, 2)).success).toBe(false);
    expect(check([terms[0], { startDate: '2026-04-10', endDate: '2026-08-14' }, terms[2]]).success).toBe(false); // starts the day Term 1 ends
    expect(check([terms[0], { startDate: '2026-04-01', endDate: '2026-08-14' }, terms[2]]).success).toBe(false); // overlaps
    expect(check([terms[0], { startDate: '2026-08-20', endDate: '2026-08-14' }, terms[2]]).success).toBe(false); // ends before it starts
    expect(check([{ startDate: '2025-12-20', endDate: '2026-04-10' }, terms[1], terms[2]]).success).toBe(false); // outside the year
    expect(check([terms[0], terms[2], terms[1]]).success).toBe(false);                                            // out of order
    expect(check(terms, 1999).success).toBe(false);
    expect(check([{ startDate: '2026-02-30', endDate: '2026-04-10' }, terms[1], terms[2]]).success).toBe(false); // no such day
  });
  it('term dates must end on or after the start', () => {
    expect(UpdateTermDatesSchema.safeParse({ startDate: '2026-05-01', endDate: '2026-05-01' }).success).toBe(true);
    expect(UpdateTermDatesSchema.safeParse({ startDate: '2026-05-02', endDate: '2026-05-01' }).success).toBe(false);
  });
  it('forms, streams and the class grid', () => {
    expect(FormsSchema.safeParse({ forms: [{ id: 'a', active: false }] }).success).toBe(true);
    expect(FormsSchema.safeParse({ forms: [] }).success).toBe(false);
    expect(StreamNameSchema.parse({ name: '  North ' }).name).toBe('North');
    for (const bad of ['', '   ', 'x'.repeat(31), 'North<script>', 'East-1']) expect(StreamNameSchema.safeParse({ name: bad }).success, bad).toBe(false);
    const cell = { levelId: 'l', stream: 'North', exists: true, capacity: 45 };
    expect(ClassGridSchema.safeParse({ cells: [cell] }).success).toBe(true);
    for (const bad of [{ capacity: 0 }, { capacity: 201 }, { capacity: 40.5 }, { capacity: '45' }, { stream: 'x'.repeat(31) }]) expect(ClassGridSchema.safeParse({ cells: [{ ...cell, ...bad }] }).success, JSON.stringify(bad)).toBe(false);
    expect(ClassGridSchema.safeParse({ cells: [] }).success).toBe(false);
  });
  it('finance: a currency on, the first one on, formats and numbers that fit', () => {
    const ok = { currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: 'USD', receiptFormat: 'RCP-{YEAR}-{000000}', receiptNextNumber: 1, invoiceFormat: 'INV-{YEAR}-{000000}', invoiceNextNumber: 1 };
    const t = (over: object) => FinanceSettingsSchema.safeParse({ ...ok, ...over }).success;
    expect(t({})).toBe(true);
    expect(t({ currencyUsdEnabled: false, defaultCurrency: 'ZIG' })).toBe(true);
    expect(t({ currencyUsdEnabled: false, currencyZigEnabled: false })).toBe(false);
    expect(t({ currencyZigEnabled: false, defaultCurrency: 'ZIG' })).toBe(false);
    expect(t({ currencyUsdEnabled: false })).toBe(false);
    expect(t({ receiptFormat: 'RCP-{YEAR}' })).toBe(false);
    expect(t({ invoiceFormat: '' })).toBe(false);
    expect(t({ receiptNextNumber: 0 })).toBe(false);
    expect(t({ receiptNextNumber: 1_000_000 })).toBe(false);
    expect(t({ receiptNextNumber: 999_999 })).toBe(true);
    expect(t({ invoiceNextNumber: 1.5 })).toBe(false);
  });
  it('numbering: a short code and a valid format', () => {
    expect(NumberingSchema.parse({ schoolCode: ' chs ', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}' }).schoolCode).toBe('CHS');
    for (const bad of [{ schoolCode: '' }, { schoolCode: 'TOOLONGCODE' }, { schoolCode: 'A-B' }, { admissionFormat: '{YEAR}' }, { admissionFormat: '{SCHOOLCODE}{YEAR}{0000}{000}' }]) {
      expect(NumberingSchema.safeParse({ schoolCode: 'CHS', admissionFormat: '{SCHOOLCODE}{YEAR}{0000}', ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it('defaults: the class size and the pin may be sent on their own', () => {
    expect(SchoolDefaultsSchema.safeParse({ maxClassSize: 40 }).success).toBe(true);
    expect(SchoolDefaultsSchema.safeParse({ setupChecklistPinned: true }).success).toBe(true);
    expect(SchoolDefaultsSchema.safeParse({}).success).toBe(false);
    expect(SchoolDefaultsSchema.safeParse({ maxClassSize: 0 }).success).toBe(false);
  });
});
