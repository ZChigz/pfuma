// Bank reconciliation. The bursar uploads a bank or EcoCash merchant statement (CSV or Excel) and maps its columns once per bank. Pfuma matches each
// line of money in to a recorded payment (by reference and amount, then by amount and date) or to a cash deposit slip, and shows what is matched,
// what is in the bank with no payment recorded, and what is recorded but not in the bank. Unmatched bank money can be turned into a payment.
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, currencySchema, dayOf, idSchema, need, whySchema, ymd, type Actor } from '@/lib/finance/common';
import { recordPayment } from '@/lib/finance/payments';
import { METHODS } from '@/lib/finance/methods';
import type { Cur } from '@/lib/finance/money';

// ─── Reading the file ────────────────────────────────────────────────────────

/** Splits CSV text into rows, honouring quoted cells with commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export async function readTable(file: { name: string; data: Buffer }): Promise<string[][]> {
  if (/\.csv$/i.test(file.name) || /\.txt$/i.test(file.name)) return parseCsv(file.data.toString('utf8'));
  if (/\.xlsx$/i.test(file.name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.data as never);
    const ws = wb.worksheets[0];
    if (!ws) throw new ServiceError('The workbook has no sheets', 422);
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = r.getCell(c).value as unknown;
        cells.push(v instanceof Date ? v.toISOString().slice(0, 10) : v && typeof v === 'object' && 'result' in (v as object) ? String((v as { result: unknown }).result ?? '') : v === null || v === undefined ? '' : String(v));
      }
      if (cells.some((x) => x.trim() !== '')) rows.push(cells);
    });
    return rows;
  }
  throw new ServiceError('Upload a CSV or Excel (.xlsx) file', 422);
}

export const MappingSchema = z.object({
  hasHeader: z.boolean().default(true),
  dateCol: z.number().int().min(0).max(60),
  dateFormat: z.enum(['YMD', 'DMY', 'MDY']).default('DMY'),
  amountCol: z.number().int().min(0).max(60).optional(),
  creditCol: z.number().int().min(0).max(60).optional(),
  debitCol: z.number().int().min(0).max(60).optional(),
  referenceCol: z.number().int().min(0).max(60).optional(),
  descriptionCol: z.number().int().min(0).max(60).optional(),
}).refine((m) => m.amountCol !== undefined || m.creditCol !== undefined, { message: 'Choose the amount column (or the credit column)', path: ['amountCol'] });
export type Mapping = z.infer<typeof MappingSchema>;

export function parseDate(s: string, fmt: Mapping['dateFormat']): string | null {
  const t = s.trim();
  if (!t) return null;
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) { y = +iso[1]!; m = +iso[2]!; d = +iso[3]!; } else {
    const p = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2,4})/.exec(t);
    if (!p) return null;
    const a = +p[1]!; const b = +p[2]!; let yy = +p[3]!;
    if (yy < 100) yy += 2000;
    if (fmt === 'MDY') { m = a; d = b; } else if (fmt === 'YMD') return null; else { d = a; m = b; }
    y = yy;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseMoney(s: string): number | null {
  const t = s.trim().replace(/[,\s]/g, '').replace(/^\(([\d.]+)\)$/, '-$1').replace(/[A-Za-z$]/g, '');
  if (t === '' || t === '-') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const neg = t.startsWith('-');
  const [w, f = ''] = t.replace('-', '').split('.');
  return (neg ? -1 : 1) * (Number(w) * 100 + Number(f.padEnd(2, '0')));
}

export interface ParsedLine { date: string; amountCents: number; reference: string | null; description: string | null }

export function applyMapping(rows: string[][], m: Mapping): { lines: ParsedLine[]; skipped: number } {
  const body = m.hasHeader ? rows.slice(1) : rows;
  const lines: ParsedLine[] = []; let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[m.dateCol] ?? '', m.dateFormat);
    let cents: number | null = null;
    if (m.amountCol !== undefined) cents = parseMoney(r[m.amountCol] ?? '');
    else {
      const cr = parseMoney(r[m.creditCol!] ?? '') ?? 0; const dr = m.debitCol !== undefined ? (parseMoney(r[m.debitCol] ?? '') ?? 0) : 0;
      cents = cr !== 0 || dr !== 0 ? Math.abs(cr) - Math.abs(dr) : null;
    }
    if (!date || cents === null || cents === 0) { skipped++; continue; }
    lines.push({ date, amountCents: cents, reference: m.referenceCol !== undefined ? ((r[m.referenceCol] ?? '').trim() || null) : null, description: m.descriptionCol !== undefined ? ((r[m.descriptionCol] ?? '').trim().slice(0, 200) || null) : null });
  }
  return { lines, skipped };
}

// ─── Matching ────────────────────────────────────────────────────────────────

interface Cand { id: string; kind: 'PAYMENT' | 'SPONSOR'; reference: string | null; cents: number; date: string }

const norm = (s: string | null) => (s ?? '').trim().toLowerCase();

/** Pairs lines of money in with recorded payments: reference and amount first, then amount and date within three days (only when it is the one candidate). */
export function matchLines(lines: { id: string; date: string; amountCents: number; reference: string | null }[], cands: Cand[], deposits: { ref: string; cents: number }[]) {
  const used = new Set<string>();
  const out = new Map<string, { kind: 'PAYMENT' | 'SPONSOR' | 'DEPOSIT'; id: string }>();
  const days = (a: string, b: string) => Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000;
  for (const l of lines) {
    if (l.amountCents <= 0) continue;
    const dep = deposits.find((d) => norm(d.ref) !== '' && norm(d.ref) === norm(l.reference) && d.cents === l.amountCents);
    if (dep) { out.set(l.id, { kind: 'DEPOSIT', id: dep.ref }); continue; }
    const hit = cands.find((c) => !used.has(c.id) && c.cents === l.amountCents && norm(c.reference) !== '' && norm(c.reference) === norm(l.reference));
    if (hit) { used.add(hit.id); out.set(l.id, { kind: hit.kind, id: hit.id }); }
  }
  for (const l of lines) {
    if (l.amountCents <= 0 || out.has(l.id)) continue;
    const near = cands.filter((c) => !used.has(c.id) && c.cents === l.amountCents && days(c.date, l.date) <= 3);
    if (near.length === 1) { used.add(near[0]!.id); out.set(l.id, { kind: near[0]!.kind, id: near[0]!.id }); }
  }
  return out;
}

async function candidates(tx: Db, schoolId: string, currency: Cur, from: string, to: string): Promise<Cand[]> {
  const lo = new Date(dayOf(from).getTime() - 5 * 86_400_000); const hi = new Date(dayOf(to).getTime() + 5 * 86_400_000);
  const [pays, spons] = await Promise.all([
    tx.finPayment.findMany({ where: { schoolId, method: { notIn: ['CASH', 'CREDIT_TRANSFER'] }, status: { not: 'REJECTED' }, voidRow: null, receivedOn: { gte: lo, lte: hi } }, select: { id: true, reference: true, receivedOn: true, currency: true, amountCents: true, paidInZig: true, zigAmountCents: true } }),
    tx.sponsorPayment.findMany({ where: { schoolId, method: { not: 'CASH' }, status: { not: 'REJECTED' }, voidedById: null, currency, receivedOn: { gte: lo, lte: hi } }, select: { id: true, reference: true, receivedOn: true, amountCents: true } }),
  ]);
  const out: Cand[] = [];
  for (const p of pays) {
    // ZiG that came in for a dollar charge is in the bank as ZiG.
    const cur: Cur = p.paidInZig ? 'ZIG' : p.currency;
    if (cur !== currency) continue;
    out.push({ id: p.id, kind: 'PAYMENT', reference: p.reference, cents: p.paidInZig ? (p.zigAmountCents ?? 0) : p.amountCents, date: ymd(p.receivedOn) });
  }
  for (const s of spons) out.push({ id: s.id, kind: 'SPONSOR', reference: s.reference, cents: s.amountCents, date: ymd(s.receivedOn) });
  return out;
}

// ─── Upload and read back ────────────────────────────────────────────────────

export const UploadSchema = z.object({ bank: z.string().trim().min(1).max(60), account: z.string().trim().max(60).default(''), currency: currencySchema, mapping: MappingSchema, fileName: z.string().max(200) });

export async function loadMapping(user: Actor, bank: string): Promise<Mapping | null> {
  need(user, 'finance.bank.reconcile');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const m = await tx.bankMapping.findUnique({ where: { schoolId_bank: { schoolId: user.schoolId, bank } } });
    return m ? (m.mapping as Mapping) : null;
  });
}

export async function listBanks(user: Actor) {
  need(user, 'finance.bank.reconcile');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => (await tx.bankMapping.findMany({ where: { schoolId: user.schoolId }, orderBy: { bank: 'asc' } })).map((b) => ({ bank: b.bank, mapping: b.mapping as Mapping })));
}

/** Keeps the mapping for the bank, reads the statement and matches it. Returns the counts. */
export async function uploadStatement(user: Actor, input: z.infer<typeof UploadSchema>, rows: string[][]) {
  need(user, 'finance.bank.reconcile');
  const parsed = UploadSchema.parse(input);
  const { lines, skipped } = applyMapping(rows, parsed.mapping);
  if (lines.length === 0) throw new ServiceError('No line of the file could be read with that mapping. Check the columns and the date format.', 422);
  if (lines.length > 20000) throw new ServiceError('The file has too many lines. Upload a shorter period.', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await tx.bankMapping.upsert({ where: { schoolId_bank: { schoolId: user.schoolId, bank: parsed.bank } }, update: { mapping: parsed.mapping as never }, create: { schoolId: user.schoolId, bank: parsed.bank, mapping: parsed.mapping as never } });
    const dates = lines.map((l) => l.date).sort();
    const st = await tx.bankStatement.create({ data: { schoolId: user.schoolId, account: parsed.account || parsed.bank, currency: parsed.currency, periodFrom: dayOf(dates[0]!), periodTo: dayOf(dates[dates.length - 1]!), fileName: parsed.fileName, uploadedById: user.id } });
    const made = await tx.bankStatementLine.createManyAndReturn({
      data: lines.map((l) => ({ schoolId: user.schoolId, statementId: st.id, date: dayOf(l.date), amountCents: l.amountCents, reference: l.reference, description: l.description, status: (l.amountCents < 0 ? 'IGNORED' : 'UNMATCHED') as 'IGNORED' | 'UNMATCHED' })),
    });
    const cands = await candidates(tx, user.schoolId, parsed.currency, dates[0]!, dates[dates.length - 1]!);
    const deposits = (await tx.cashUp.findMany({ where: { schoolId: user.schoolId, depositRef: { not: null }, status: { in: ['CONFIRMED', 'SIGNED_OFF'] } }, select: { depositRef: true, countedUsdCents: true, countedZigCents: true } }))
      .map((c) => ({ ref: c.depositRef!, cents: parsed.currency === 'USD' ? c.countedUsdCents : c.countedZigCents }));
    const found = matchLines(made.map((l) => ({ id: l.id, date: ymd(l.date), amountCents: l.amountCents, reference: l.reference })), cands, deposits);
    for (const [lineId, m] of Array.from(found.entries())) {
      await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'MATCHED', matchedPaymentId: m.kind === 'PAYMENT' ? m.id : null, matchedSponsorPaymentId: m.kind === 'SPONSOR' ? m.id : null, matchedDepositRef: m.kind === 'DEPOSIT' ? m.id : null } });
    }
    await audit(tx, user, 'UPLOAD_BANK_STATEMENT', 'BankStatement', st.id, `Uploaded ${parsed.fileName}: ${lines.length} line(s), ${found.size} matched`, undefined, { bank: parsed.bank, currency: parsed.currency, lines: lines.length, matched: found.size, skipped });
    return { id: st.id, lines: lines.length, matched: found.size, unmatched: made.filter((l) => l.amountCents > 0).length - found.size, skipped };
  });
}

export async function listStatements(user: Actor) {
  need(user, 'finance.bank.reconcile');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.bankStatement.findMany({ where: { schoolId: user.schoolId }, orderBy: { createdAt: 'desc' }, take: 40, include: { _count: { select: { lines: true } } } });
    const matched = await tx.bankStatementLine.groupBy({ by: ['statementId', 'status'], where: { schoolId: user.schoolId, statementId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    return rows.map((r) => ({
      id: r.id, account: r.account, currency: r.currency as Cur, fileName: r.fileName, from: r.periodFrom ? ymd(r.periodFrom) : null, to: r.periodTo ? ymd(r.periodTo) : null, lines: r._count.lines,
      matched: matched.find((m) => m.statementId === r.id && m.status === 'MATCHED')?._count._all ?? 0, unmatched: matched.find((m) => m.statementId === r.id && m.status === 'UNMATCHED')?._count._all ?? 0,
    }));
  });
}

/** One statement: matched lines, money in the bank with no payment recorded, and payments recorded that the bank does not show. */
export async function getStatement(user: Actor, id: string) {
  need(user, 'finance.bank.reconcile');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const st = await tx.bankStatement.findFirst({ where: { id, schoolId: user.schoolId }, include: { lines: { orderBy: [{ date: 'asc' }, { amountCents: 'desc' }] } } });
    if (!st) throw new ServiceError('Statement not found', 404);
    const from = ymd(st.periodFrom ?? st.createdAt); const to = ymd(st.periodTo ?? st.createdAt);
    const cands = await candidates(tx, user.schoolId, st.currency, from, to);
    const taken = new Set(st.lines.flatMap((l) => [l.matchedPaymentId, l.matchedSponsorPaymentId]).filter((x): x is string => !!x));
    const allMatched = await tx.bankStatementLine.findMany({ where: { schoolId: user.schoolId, status: 'MATCHED', statementId: { not: id } }, select: { matchedPaymentId: true, matchedSponsorPaymentId: true } });
    for (const m of allMatched) { if (m.matchedPaymentId) taken.add(m.matchedPaymentId); if (m.matchedSponsorPaymentId) taken.add(m.matchedSponsorPaymentId); }
    const missing = cands.filter((c) => !taken.has(c.id) && c.date >= from && c.date <= to);
    const payInfo = await tx.finPayment.findMany({ where: { schoolId: user.schoolId, id: { in: missing.filter((m) => m.kind === 'PAYMENT').map((m) => m.id) } }, select: { id: true, receiptNumber: true, ackNumber: true, student: { select: { fullName: true } } } });
    const pi = new Map(payInfo.map((p) => [p.id, p]));
    return {
      id: st.id, account: st.account, currency: st.currency as Cur, fileName: st.fileName, from, to,
      lines: st.lines.map((l) => ({ id: l.id, date: ymd(l.date), amountCents: l.amountCents, reference: l.reference, description: l.description, status: l.status, matchedPaymentId: l.matchedPaymentId, matchedSponsorPaymentId: l.matchedSponsorPaymentId, matchedDepositRef: l.matchedDepositRef })),
      notInSystem: st.lines.filter((l) => l.status === 'UNMATCHED').length,
      notInBank: missing.map((m) => ({ id: m.id, kind: m.kind, reference: m.reference, cents: m.cents, date: m.date, receipt: pi.get(m.id)?.receiptNumber ?? pi.get(m.id)?.ackNumber ?? null, student: pi.get(m.id)?.student.fullName ?? null })),
    };
  });
}

export const MakePaymentSchema = z.object({ studentId: idSchema.optional(), guardianId: idSchema.optional(), method: z.enum(METHODS).default('BANK_TRANSFER'), fundId: idSchema.nullable().optional() });

/** Money in the bank with no payment recorded becomes a payment for the right learner (or family), dated and referenced as the bank shows it. */
export async function paymentFromLine(user: Actor, lineId: string, raw: unknown) {
  need(user, 'finance.bank.reconcile');
  const input = MakePaymentSchema.parse(raw);
  const line = await getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const l = await tx.bankStatementLine.findFirst({ where: { id: lineId, schoolId: user.schoolId }, include: { statement: { select: { currency: true } } } });
    if (!l) throw new ServiceError('Line not found', 404);
    if (l.status !== 'UNMATCHED' || l.amountCents <= 0) throw new ServiceError('Only unmatched money in can become a payment', 409);
    return { id: l.id, date: ymd(l.date), cents: l.amountCents, reference: l.reference, currency: l.statement.currency as Cur };
  });
  const made = await recordPayment(user, {
    studentId: input.studentId, guardianId: input.guardianId, currency: line.currency, method: input.method, reference: line.reference ?? `BANK-${line.id.slice(-8)}`, receivedOn: line.date,
    backdateReason: 'From the bank statement', note: 'Made from a bank statement line', lines: [{ fundId: input.fundId ?? null, amount: (line.cents / 100).toFixed(2) }],
  });
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await tx.bankStatementLine.update({ where: { id: line.id }, data: { status: 'MATCHED', matchedPaymentId: made.payments[0]!.id } });
    await audit(tx, user, 'MATCH_BANK_LINE', 'BankStatementLine', line.id, 'Made a payment from a bank statement line', { status: 'UNMATCHED' }, { status: 'MATCHED', paymentId: made.payments[0]!.id, amountCents: line.cents });
    return { paymentId: made.payments[0]!.id };
  });
}

export async function ignoreLine(user: Actor, lineId: string, rawReason: unknown) {
  need(user, 'finance.bank.reconcile');
  const reason = whySchema(5).parse(rawReason);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const l = await tx.bankStatementLine.findFirst({ where: { id: lineId, schoolId: user.schoolId } });
    if (!l || l.status !== 'UNMATCHED') throw new ServiceError('Only an unmatched line can be set aside', 409);
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'IGNORED' } });
    await audit(tx, user, 'MATCH_BANK_LINE', 'BankStatementLine', lineId, `Set a bank line aside: ${reason}`, { status: 'UNMATCHED' }, { status: 'IGNORED', reason });
    return { id: lineId };
  });
}

/** Matches an unmatched line by hand to a payment the system already has. */
export async function matchLineTo(user: Actor, lineId: string, paymentId: string) {
  need(user, 'finance.bank.reconcile');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const l = await tx.bankStatementLine.findFirst({ where: { id: lineId, schoolId: user.schoolId } });
    if (!l || l.status !== 'UNMATCHED') throw new ServiceError('Only an unmatched line can be matched', 409);
    const isPay = await tx.finPayment.findFirst({ where: { id: paymentId, schoolId: user.schoolId }, select: { id: true } });
    const isSp = isPay ? null : await tx.sponsorPayment.findFirst({ where: { id: paymentId, schoolId: user.schoolId }, select: { id: true } });
    if (!isPay && !isSp) throw new ServiceError('Payment not found', 404);
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'MATCHED', matchedPaymentId: isPay ? paymentId : null, matchedSponsorPaymentId: isSp ? paymentId : null } });
    await audit(tx, user, 'MATCH_BANK_LINE', 'BankStatementLine', lineId, 'Matched a bank line to a payment by hand', { status: 'UNMATCHED' }, { status: 'MATCHED', paymentId });
    return { id: lineId };
  });
}
