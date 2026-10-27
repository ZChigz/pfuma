// Small helpers the serializers share.
export type Row = Record<string, unknown>;

/** Only the last `n` characters show; the rest become dots. A value no longer than `n` shows as dots only. */
export function maskTail(value: unknown, n: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  return s.length <= n ? '•'.repeat(s.length) : `${'•'.repeat(Math.min(s.length - n, 8))}${s.slice(-n)}`;
}

/** A copy of the row without these fields. */
export function omit<T extends Row>(row: T, fields: readonly string[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!fields.includes(k)) out[k] = v;
  return out;
}

/** A copy of the row with only these fields (those it has). */
export function pick<T extends Row>(row: T, fields: readonly string[]): Row {
  const out: Row = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}
