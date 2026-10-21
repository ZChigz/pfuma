// Statements and arrears. A statement lists a learner's (or a whole family's) charges, adjustments, payments and refunds with a running balance per
// currency; with a term chosen it opens with the balance brought forward. The arrears list ranks who owes what, by how long it has been owing.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { currencySchema, idSchema, need, ymd, type Actor } from '@/lib/finance/common';
import { chargeLines, studentAccount, type StatementEntry, paymentCredits } from '@/lib/finance/balances';
import { planStatusByStudent } from '@/lib/finance/plans';
import { feePayerContacts, queueSms } from '@/lib/finance/sms';
import { CURRENCIES, formatMoney, type Cur } from '@/lib/finance/money';

export interface StatementView {
  student: { id: string; fullName: string; admissionNumber: string | null; className: string | null };
  school: { name: string };
  term: { id: string; name: string } | null;
  /** Balance brought forward into the chosen term, per currency (zero when no term is chosen). */
  opening: Record<Cur, number>;
  entries: StatementEntry[];
  closing: Record<Cur, number>;
  credit: Record<Cur, number>;
  generatedAt: string;
}

const zero = (): Record<Cur, number> => ({ USD: 0, ZIG: 0 });

export async function studentStatement(user: Actor, studentId: string, termId?: string): Promise<StatementView> {
  need(user, 'finance.statements.view', 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx((tx) => buildStatement(tx, user.schoolId, studentId, termId));
}

export async function buildStatement(tx: Db, schoolId: string, studentId: string, termId?: string): Promise<StatementView> {
  const [acct, student, school, term] = await Promise.all([
    studentAccount(tx, schoolId, studentId),
    tx.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } as never }),
    tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
    termId ? tx.academicTerm.findFirst({ where: { id: termId, schoolId }, select: { id: true, name: true, startDate: true, endDate: true } }) : Promise.resolve(null),
  ]);
  if (!student) throw new ServiceError('Student not found', 404);
  if (termId && !term) throw new ServiceError('Term not found', 404);
  const s = student as unknown as { id: string; fullName: string; admissionNumber: string | null; currentClass?: { name: string } | null };
  let entries = acct.statement;
  const opening = zero();
  if (term) {
    const from = term.startDate.toISOString();
    const to = new Date(term.endDate.getTime() + 86_400_000).toISOString();
    for (const e of entries) if (e.at < from && e.counts) opening[e.currency] += e.debitCents - e.creditCents;
    entries = entries.filter((e) => e.at >= from && e.at < to);
  }
  const closing = { ...opening };
  for (const e of entries) if (e.counts) closing[e.currency] += e.debitCents - e.creditCents;
  const credit = zero();
  for (const c of acct.credits) credit[c.currency] += c.creditCents;
  return {
    student: { id: s.id, fullName: s.fullName, admissionNumber: s.admissionNumber ?? null, className: s.currentClass?.name ?? null },
    school: { name: school?.name ?? '' }, term: term ? { id: term.id, name: term.name } : null, opening, entries, closing, credit, generatedAt: new Date().toISOString(),
  };
}

/** A family statement: every child of one guardian, one statement each, with the family's total per currency. */
export async function familyStatement(user: Actor, guardianId: string, termId?: string) {
  need(user, 'finance.statements.view', 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const links = await tx.studentGuardian.findMany({ where: { guardianId, student: { schoolId: user.schoolId } }, select: { studentId: true } });
    if (links.length === 0) throw new ServiceError('Guardian not found', 404);
    const guardian = await tx.guardian.findFirst({ where: { id: guardianId, schoolId: user.schoolId }, select: { id: true, fullName: true, phone: true } });
    const statements = [];
    for (const l of links) statements.push(await buildStatement(tx, user.schoolId, l.studentId, termId));
    const total = zero();
    for (const s of statements) for (const c of CURRENCIES) total[c] += s.closing[c];
    return { guardian, statements, total };
  });
}

/** The text a guardian gets: what is owed in each currency, plainly. */
export function statementText(schoolName: string, studentName: string, closing: Record<Cur, number>): string {
  const owed = CURRENCIES.filter((c) => closing[c] > 0).map((c) => formatMoney(closing[c], c));
  return owed.length === 0 ? `${schoolName}: ${studentName}'s fees account is fully paid. Thank you.` : `${schoolName}: ${studentName} owes ${owed.join(' and ')} in school fees. Please pay at the bursary or by EcoCash.`;
}

export async function sendStatementSms(user: Actor, studentId: string) {
  need(user, 'finance.statements.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const st = await buildStatement(tx, user.schoolId, studentId);
    const contacts = await feePayerContacts(tx, user.schoolId, studentId);
    if (contacts.length === 0) throw new ServiceError('No guardian with a phone number to send to', 409);
    const queued = await queueSms(tx, user.schoolId, contacts, statementText(st.school.name, st.student.fullName, st.closing), { studentId });
    return { queued };
  });
}

// ─── Arrears ─────────────────────────────────────────────────────────────────

export const ArrearsQuery = z.object({
  currency: currencySchema.optional(), classId: idSchema.optional(), termId: idSchema.optional(), fundId: idSchema.optional(),
  minCents: z.coerce.number().int().min(0).optional(), onlyOverdue: z.coerce.boolean().optional(), search: z.string().trim().max(80).optional(),
});

export const BUCKETS = ['CURRENT', 'D30', 'D60', 'D90', 'D90P'] as const;
export type Bucket = (typeof BUCKETS)[number];
export const bucketOf = (days: number): Bucket => (days <= 0 ? 'CURRENT' : days <= 30 ? 'D30' : days <= 60 ? 'D60' : days <= 90 ? 'D90' : 'D90P');

export interface ArrearsRow {
  studentId: string; fullName: string; admissionNumber: string | null; className: string | null; guardian: string | null; phone: string | null;
  owed: Record<Cur, number>; buckets: Record<Cur, Record<Bucket, number>>; oldestDays: number; lastPayment: { date: string; currency: Cur; amountCents: number } | null;
  plan: 'ON_PLAN' | 'PLAN_MISSED' | null;
}

const emptyBuckets = (): Record<Bucket, number> => ({ CURRENT: 0, D30: 0, D60: 0, D90: 0, D90P: 0 });

/** Learners with an outstanding balance, aged from when the term's fees fell due (the term's start date). */
export async function arrearsList(user: Actor, raw: unknown = {}) {
  need(user, 'finance.statements.view', 'finance.accounts.view');
  const q = ArrearsQuery.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const lines = (await chargeLines(tx, user.schoolId, { termId: q.termId, fundId: q.fundId, currency: q.currency })).filter((l) => l.outstanding > 0);
    const ids = Array.from(new Set(lines.map((l) => l.studentId)));
    if (ids.length === 0) return { rows: [] as ArrearsRow[], totals: { owed: zero(), buckets: { USD: emptyBuckets(), ZIG: emptyBuckets() } } };
    const [students, links, lastPays, plans] = await Promise.all([
      tx.student.findMany({ where: { schoolId: user.schoolId, id: { in: ids }, ...(q.classId ? { currentClassId: q.classId } : {}) } as never, select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } as never }),
      tx.studentGuardian.findMany({ where: { studentId: { in: ids }, isFeePayer: true }, select: { studentId: true, guardian: { select: { fullName: true, phone: true } } } }),
      tx.finPayment.findMany({ where: { schoolId: user.schoolId, studentId: { in: ids }, status: 'VERIFIED', voidRow: null }, orderBy: { receivedOn: 'desc' }, select: { studentId: true, receivedOn: true, currency: true, amountCents: true }, take: 5000 }),
      planStatusByStudent(tx, user.schoolId, ids),
    ]);
    const sm = new Map((students as unknown as { id: string; fullName: string; admissionNumber: string | null; currentClass?: { name: string } | null }[]).map((s) => [s.id, s]));
    const gm = new Map(links.map((l) => [l.studentId, l.guardian]));
    const lp = new Map<string, { date: string; currency: Cur; amountCents: number }>();
    for (const p of lastPays) if (p.studentId && !lp.has(p.studentId)) lp.set(p.studentId, { date: ymd(p.receivedOn), currency: p.currency, amountCents: p.amountCents });
    const now = Date.now();
    const byStudent = new Map<string, ArrearsRow>();
    for (const l of lines) {
      const s = sm.get(l.studentId);
      if (!s) continue;
      const days = Math.floor((now - l.termStart.getTime()) / 86_400_000);
      let row = byStudent.get(l.studentId);
      if (!row) {
        const g = gm.get(l.studentId);
        row = { studentId: s.id, fullName: s.fullName, admissionNumber: s.admissionNumber ?? null, className: s.currentClass?.name ?? null, guardian: g?.fullName ?? null, phone: g?.phone ?? null, owed: zero(), buckets: { USD: emptyBuckets(), ZIG: emptyBuckets() }, oldestDays: 0, lastPayment: lp.get(s.id) ?? null, plan: plans.get(s.id) ?? null };
        byStudent.set(l.studentId, row);
      }
      row.owed[l.currency] += l.outstanding;
      row.buckets[l.currency][bucketOf(days)] += l.outstanding;
      row.oldestDays = Math.max(row.oldestDays, days);
    }
    let rows = Array.from(byStudent.values());
    if (q.minCents) rows = rows.filter((r) => CURRENCIES.some((c) => r.owed[c] >= q.minCents!));
    if (q.onlyOverdue) rows = rows.filter((r) => r.oldestDays > 0);
    if (q.search) { const s = q.search.toLowerCase(); rows = rows.filter((r) => r.fullName.toLowerCase().includes(s) || (r.admissionNumber ?? '').toLowerCase().includes(s)); }
    rows.sort((a, b) => b.oldestDays - a.oldestDays || a.fullName.localeCompare(b.fullName));
    const totals = { owed: zero(), buckets: { USD: emptyBuckets(), ZIG: emptyBuckets() } };
    for (const r of rows) for (const c of CURRENCIES) { totals.owed[c] += r.owed[c]; for (const b of BUCKETS) totals.buckets[c][b] += r.buckets[c][b]; }
    return { rows, totals };
  });
}

export const BulkSmsSchema = z.object({ studentIds: z.array(idSchema).min(1).max(500) });

/** A text to each chosen learner's fee payer saying what is owed. Skips learners with no phone. */
export async function bulkArrearsSms(user: Actor, raw: unknown) {
  need(user, 'finance.statements.view');
  const { studentIds } = BulkSmsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    let queued = 0; let skipped = 0;
    for (const id of studentIds) {
      const contacts = await feePayerContacts(tx, user.schoolId, id);
      if (contacts.length === 0) { skipped++; continue; }
      const st = await buildStatement(tx, user.schoolId, id);
      if (!CURRENCIES.some((c) => st.closing[c] > 0)) { skipped++; continue; }
      queued += await queueSms(tx, user.schoolId, contacts, statementText(st.school.name, st.student.fullName, st.closing), { studentId: id });
    }
    return { queued, skipped };
  });
}

/** Learners the class teacher should know owe fees (a marker only: no amounts). */
export async function feesOutstandingFor(tx: Db, schoolId: string, studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const lines = await chargeLines(tx, schoolId, { studentIds });
  return new Set(lines.filter((l) => l.outstanding > 0).map((l) => l.studentId));
}

export { paymentCredits };
