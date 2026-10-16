// Number formats for receipts, invoices and admission numbers, e.g. "RCP-{YEAR}-{000000}".
//
//   {YEAR}        four-digit year          2026
//   {YY}          two-digit year           26
//   {SCHOOLCODE}  the school's short code  STU
//   {0000}        the running number, zero-padded to as many digits as there are zeros (1 to 10)
//
// Everything else is copied as written: letters, digits and - / _ . and spaces.
// A format needs exactly one running number.

export type FormatPart =
  | { type: 'text'; text: string }
  | { type: 'year' }
  | { type: 'yy' }
  | { type: 'code' }
  | { type: 'counter'; width: number };

export const FORMAT_MAX_LENGTH = 40;
export const MAX_COUNTER_WIDTH = 10;

export type ParsedFormat = { ok: true; parts: FormatPart[]; width: number } | { ok: false; error: string };

const TOKEN = /\{([^{}]*)\}/g;

export function parseFormat(format: string): ParsedFormat {
  if (format.length === 0) return { ok: false, error: 'Enter a format' };
  if (format.length > FORMAT_MAX_LENGTH) return { ok: false, error: `Use ${FORMAT_MAX_LENGTH} characters or fewer` };

  const parts: FormatPart[] = [];
  let last = 0;
  let counters = 0;
  let width = 0;
  const pushText = (t: string): string | null => {
    if (t === '') return null;
    if (!/^[A-Za-z0-9/_. -]+$/.test(t)) return 'Only letters, digits and - / _ . can be written as they are; put anything else in the tokens {YEAR}, {YY}, {SCHOOLCODE} or {000000}';
    parts.push({ type: 'text', text: t });
    return null;
  };

  for (const m of Array.from(format.matchAll(TOKEN))) {
    const err = pushText(format.slice(last, m.index));
    if (err) return { ok: false, error: err };
    const inner = m[1];
    if (inner === 'YEAR') parts.push({ type: 'year' });
    else if (inner === 'YY') parts.push({ type: 'yy' });
    else if (inner === 'SCHOOLCODE') parts.push({ type: 'code' });
    else if (/^0+$/.test(inner)) {
      if (inner.length > MAX_COUNTER_WIDTH) return { ok: false, error: `The running number can have at most ${MAX_COUNTER_WIDTH} digits` };
      counters++;
      width = inner.length;
      parts.push({ type: 'counter', width: inner.length });
    } else return { ok: false, error: `Unknown token {${inner}}. Use {YEAR}, {YY}, {SCHOOLCODE} or zeros such as {0000}` };
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = format.slice(last);
  if (/[{}]/.test(tail)) return { ok: false, error: 'A { or } is not closed' };
  const err = pushText(tail);
  if (err) return { ok: false, error: err };

  if (counters === 0) return { ok: false, error: 'Include the running number, e.g. {0000}' };
  if (counters > 1) return { ok: false, error: 'Use the running number {0000} only once' };
  return { ok: true, parts, width };
}

export interface NumberContext {
  year: number;
  schoolCode: string;
}

export function formatNumber(format: string, ctx: NumberContext, n: number): string {
  const parsed = parseFormat(format);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.parts
    .map((p) => {
      switch (p.type) {
        case 'text': return p.text;
        case 'year': return String(ctx.year);
        case 'yy': return String(ctx.year).slice(-2);
        case 'code': return ctx.schoolCode;
        case 'counter': {
          const digits = String(n);
          if (digits.length > p.width) throw new Error(`The running number ${n} does not fit in ${p.width} digits`);
          return digits.padStart(p.width, '0');
        }
      }
    })
    .join('');
}

/** The largest running number the format can hold (9999 for {0000}). */
export function maxCounter(format: string): number {
  const parsed = parseFormat(format);
  return parsed.ok ? 10 ** parsed.width - 1 : 0;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What an existing number looks like for this format and year, so the highest one used can be
 * found: group 1 is the running number. Null if the format is invalid.
 */
export function counterPattern(format: string, ctx: NumberContext): { regex: RegExp; prefix: string } | null {
  const parsed = parseFormat(format);
  if (!parsed.ok) return null;
  let source = '^';
  let prefix = '';
  let before = true;
  for (const p of parsed.parts) {
    if (p.type === 'counter') {
      source += `(\\d{${p.width}})`;
      before = false;
      continue;
    }
    const text = p.type === 'text' ? p.text : p.type === 'year' ? String(ctx.year) : p.type === 'yy' ? String(ctx.year).slice(-2) : ctx.schoolCode;
    source += escapeRe(text);
    if (before) prefix += text;
  }
  return { regex: new RegExp(`${source}$`), prefix };
}

/** A preview using the next number: "RCP-2026-000014". Returns null if the format is invalid. */
export function previewNumber(format: string, ctx: NumberContext, n: number): string | null {
  try {
    return formatNumber(format, ctx, n);
  } catch {
    return null;
  }
}

export const DEFAULT_ADMISSION_FORMAT = '{SCHOOLCODE}{YEAR}{0000}';
export const DEFAULT_RECEIPT_FORMAT = 'RCP-{YEAR}-{000000}';
export const DEFAULT_INVOICE_FORMAT = 'INV-{YEAR}-{000000}';
