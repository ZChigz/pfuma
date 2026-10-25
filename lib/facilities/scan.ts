// What a scanned barcode or QR code means. Pure, so the phone screens, the desk screens and the tests share it.
//
// A label printed by Pfuma carries "PF:<kind>:<value>" (for example "PF:student:STU20260042"). Labels that came with the book or the
// ID card carry only the value; the screen that scans says what it expects, and an asset tag (AST-00412) is recognised on its own.

export type ScanKind = 'student' | 'staff' | 'copy' | 'asset' | 'item' | 'unknown';

export interface Scan {
  /** The code as read, trimmed. */
  raw: string;
  /** The value to look up. */
  value: string;
  /** What the label says it is, or "unknown" for a bare value. */
  kind: ScanKind;
}

const KINDS: readonly ScanKind[] = ['student', 'staff', 'copy', 'asset', 'item'];
const ASSET_TAG = /^AST-\d{3,}$/i;

/** Strips control characters (a keyboard-wedge scanner sends Enter or Tab after the code) and surrounding space. */
export function cleanScan(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

export function parseScan(input: string): Scan {
  const raw = cleanScan(input);
  const m = /^PF:([a-z]+):(.+)$/i.exec(raw);
  if (m) {
    const kind = m[1]!.toLowerCase() as ScanKind;
    if (KINDS.includes(kind)) return { raw, value: m[2]!.trim(), kind };
  }
  if (ASSET_TAG.test(raw)) return { raw, value: raw.toUpperCase(), kind: 'asset' };
  return { raw, value: raw, kind: 'unknown' };
}

/** The text to print in a Pfuma QR label. */
export function labelPayload(kind: Exclude<ScanKind, 'unknown'>, value: string): string {
  return `PF:${kind}:${value}`;
}

/**
 * Checks a scan against what the screen expects. A bare value is accepted (the label may be the maker's own); a Pfuma label of a
 * different kind is refused so a book is never taken for a learner.
 */
export function expectScan(input: string, expected: Exclude<ScanKind, 'unknown'>): { ok: true; value: string } | { ok: false; reason: string } {
  const scan = parseScan(input);
  if (!scan.value) return { ok: false, reason: 'Nothing was read. Try again.' };
  if (scan.kind !== 'unknown' && scan.kind !== expected) {
    return { ok: false, reason: `That is a ${scan.kind} label, but a ${expected} is needed here.` };
  }
  return { ok: true, value: scan.value };
}

/** Ignores the same code read again within a short time (a camera sees one label in many frames). */
export function createDebouncer(windowMs = 1500, now: () => number = Date.now) {
  let last = '';
  let at = 0;
  return (code: string): boolean => {
    const t = now();
    if (code === last && t - at < windowMs) return false;
    last = code;
    at = t;
    return true;
  };
}
