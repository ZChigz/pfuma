// The pure part of importing marks (no database), so the browser can read an uploaded CSV with the same rules as the server.

/** A file that is not a mark template. */
export class TableError extends Error {}

export const MAX_IMPORT_ROWS = 400;
export const TEMPLATE_HEADERS = ['Admission number', 'Name', 'Mark'];

export type RowStatus = 'OK' | 'UNCHANGED' | 'ERROR';
export interface ReviewRow {
  line: number;
  admissionNumber: string;
  name: string;
  raw: string;
  status: RowStatus;
  message: string | null;
  /** The cell to save when the row is good. */
  cell: { studentId: string; assessmentId: string; stageId: string | null; value: number | null; code: 'AB' | 'EX' | 'NS' | null } | null;
  before: string;
}

export interface ImportReview {
  title: string;
  max: number;
  rows: ReviewRow[];
  /** Students on the class list who are not in the file. */
  notInFile: { admissionNumber: string; name: string }[];
  counts: { ok: number; unchanged: number; errors: number; total: number };
}

/** Finds the columns of an uploaded sheet (the first row is the header) and returns the rows to review. */
export function rowsFromTable(table: string[][]): { admissionNumber: string; name: string; mark: string }[] {
  if (table.length < 2) throw new TableError('The file has no rows');
  const head = table[0]!.map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.startsWith(n)));
  const adm = col('admission', 'adm', 'student number', 'reg');
  const name = col('name', 'student');
  const mark = col('mark', 'score', 'result');
  if (adm < 0 || mark < 0) throw new TableError('The file needs the columns "Admission number" and "Mark" in its first row. Download the template to start.');
  return table.slice(1).filter((r) => r.some((c) => c.trim() !== '')).map((r) => ({ admissionNumber: (r[adm] ?? '').trim(), name: name >= 0 ? (r[name] ?? '').trim() : '', mark: (r[mark] ?? '').trim() }));
}
