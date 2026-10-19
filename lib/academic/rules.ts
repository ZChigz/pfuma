// Pure academic-structure rules (no database access) — shared by the services,
// the CSV import and the tests.

export const LEVEL_DEFINITIONS = [
  { order: 1, name: 'Form 1', category: 'O_LEVEL' },
  { order: 2, name: 'Form 2', category: 'O_LEVEL' },
  { order: 3, name: 'Form 3', category: 'O_LEVEL' },
  { order: 4, name: 'Form 4', category: 'O_LEVEL' },
  { order: 5, name: 'Form 5', category: 'A_LEVEL' },
  { order: 6, name: 'Form 6', category: 'A_LEVEL' },
] as const;

export const MIN_LEVEL_ORDER = 1;
export const MAX_LEVEL_ORDER = 6;

// Leavers: end of O-Level (Form 4) or A-Level (Form 6).
export const GRADUATING_LEVEL_ORDERS = [4, 6] as const;

export const DEFAULT_STREAMS = ['North', 'South', 'East'] as const;

const WORD_NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six'];

// "Form 2", "form2", "F2", "2", "Form Two", "Lower Six" → 2/5…; null if not a Form 1–6 level.
export function parseLevelOrder(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  let m = s.match(/^(?:form|frm|f)?\s*[-.]?\s*([1-6])$/);
  if (m) return Number(m[1]);
  m = s.match(/^(?:form|frm|f)\s*[-.]?\s*(one|two|three|four|five|six)$/);
  if (m) return WORD_NUMBERS.indexOf(m[1]) + 1;
  if (/^(lower|l)\s*(6|six|6th|sixth)(\s*form)?$/.test(s)) return 5;
  if (/^(upper|u)\s*(6|six|6th|sixth)(\s*form)?$/.test(s)) return 6;
  return null;
}

export function levelName(order: number): string {
  return `Form ${order}`;
}

export function canGraduate(levelOrder: number): boolean {
  return (GRADUATING_LEVEL_ORDERS as readonly number[]).includes(levelOrder);
}

export function nextLevelOrder(levelOrder: number): number | null {
  return levelOrder < MAX_LEVEL_ORDER ? levelOrder + 1 : null;
}

// "Form 2" + "East" → "Form 2 East"; a level with a single class has stream "".
export function classDisplayName(level: string, stream: string): string {
  return stream ? `${level} ${stream}` : level;
}

export function normalizeStream(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  return s.replace(/\S+/g, (w) => (w === w.toLowerCase() || w === w.toUpperCase()
    ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    : w));
}

// ─── Terms ───────────────────────────────────────────────────────────────────

export const TERMS_PER_YEAR = 3;

export function termName(termNumber: number, year: number): string {
  return `Term ${termNumber} ${year}`;
}

// Default calendar for a new academic year (editable afterwards):
// Term 1 Jan–Apr, Term 2 May–Aug, Term 3 Sep–Dec.
export function defaultTermDates(year: number, termNumber: number): { startDate: string; endDate: string } {
  const startMonth = (termNumber - 1) * 4 + 1;
  const endMonth = startMonth + 3;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    startDate: `${year}-${pad(startMonth)}-01`,
    endDate: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

export interface TermDates {
  termNumber: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

// Terms in one year must each start before they end, sit inside the year,
// and not overlap, in term-number order. Returns a plain-English problem or null.
export function validateTermDates(year: number, yearStart: string, yearEnd: string, terms: TermDates[]): string | null {
  const sorted = [...terms].sort((a, b) => a.termNumber - b.termNumber);
  for (const t of sorted) {
    if (t.startDate > t.endDate) return `Term ${t.termNumber} ${year} must start before it ends`;
    if (t.startDate < yearStart || t.endDate > yearEnd) {
      return `Term ${t.termNumber} ${year} must fall inside the academic year (${yearStart} to ${yearEnd})`;
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startDate <= sorted[i - 1].endDate) {
      return `Term ${sorted[i].termNumber} ${year} must start after Term ${sorted[i - 1].termNumber} ends`;
    }
  }
  return null;
}

export type TermStatus = 'PLANNED' | 'OPEN' | 'CLOSED';

// Rule check for opening a term; returns a problem or null.
export function canOpenTerm(term: { status: TermStatus; name: string }, currentlyOpen: { id: string; name: string } | null, termId: string): string | null {
  if (term.status === 'OPEN') return `${term.name} is already open`;
  if (term.status === 'CLOSED') return `${term.name} has been closed and cannot be reopened`;
  if (currentlyOpen && currentlyOpen.id !== termId) return `Close ${currentlyOpen.name} before opening ${term.name}`;
  return null;
}

export function canCloseTerm(term: { status: TermStatus; name: string }): string | null {
  if (term.status !== 'OPEN') return `${term.name} is not open`;
  return null;
}
