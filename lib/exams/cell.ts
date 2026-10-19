// What a teacher can type into a mark cell. Pure (no database), so the grid in the browser and the server check the same way.
//
//   a number from 0 up to the maximum mark, at most two decimals ("12", "12.5", "12,5")
//   AB  absent        EX  exempt (joined late, medical)        NS  not submitted (counts as 0)
//   empty clears the cell
// Anything else is refused with a message the grid shows in the cell.
import { round2 } from '@/lib/results/legacy';
import type { MarkCode } from '@/lib/results/types';

export type TypedCode = Exclude<MarkCode, 'AB_EXCUSED'>;
export const TYPED_CODES: TypedCode[] = ['AB', 'EX', 'NS'];

export interface CellValue { value: number | null; code: TypedCode | null }
export type ParsedCell = { ok: true; cell: CellValue } | { ok: false; message: string };

export function parseCell(text: string, max: number): ParsedCell {
  const t = text.trim().replace(/\s+/g, '').toUpperCase();
  if (t === '') return { ok: true, cell: { value: null, code: null } };
  if ((TYPED_CODES as string[]).includes(t)) return { ok: true, cell: { value: null, code: t as TypedCode } };
  const n = t.replace(',', '.');
  if (/^-/.test(n) && /^-\d*\.?\d+$/.test(n)) return { ok: false, message: 'A mark cannot be negative' };
  if (!/^\d+(\.\d{1,2})?$/.test(n) && !/^\.\d{1,2}$/.test(n)) {
    return { ok: false, message: /^\d+\.\d{3,}$/.test(n) ? 'Use at most two decimal places' : 'Enter a number, or AB, EX or NS' };
  }
  const value = round2(Number(n));
  if (value > max) return { ok: false, message: `Above the maximum of ${max}` };
  return { ok: true, cell: { value, code: null } };
}

/** How a stored mark is shown in its cell. */
export function cellText(m: { value: number | null; code: MarkCode | null } | undefined): string {
  if (!m) return '';
  if (m.value !== null) return String(m.value);
  if (m.code === 'AB_EXCUSED') return 'AB*';
  return m.code ?? '';
}

export const CODE_HELP: Record<MarkCode, string> = {
  AB: 'Absent',
  EX: 'Exempt: left out of the term mark',
  NS: 'Not submitted: counts as 0',
  AB_EXCUSED: 'Absence excused by the Head: left out of the term mark',
};

/** The key of a cell in the grid and in the offline queue (the same key the calculation reads marks by). */
export { markKey as cellKey } from '@/lib/results/preview';
/** The key of a column of the grid: an assessment, or one stage of a project. */
export const columnKey = (assessmentId: string, stageId: string | null | undefined) => `${assessmentId}|${stageId ?? ''}`;
export function splitCellKey(key: string): { studentId: string; assessmentId: string; stageId: string | null } {
  const [studentId = '', assessmentId = '', stageId = ''] = key.split('|');
  return { studentId, assessmentId, stageId: stageId || null };
}

/** Splits text pasted from Excel (rows by new line, columns by tab) into a grid of strings. */
export function parsePaste(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows.map((r) => r.split('\t'));
}
