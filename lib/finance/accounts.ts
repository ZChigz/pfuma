// Student accounts: who owes what (per currency, per fund) and a student's statement. Balances come from lib/finance/balances.ts.
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import type { PermissionKey } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { need, type Actor } from '@/lib/finance/common';
import { balancesOf, emptyByCurrency, studentAccount, type ByCurrency } from '@/lib/finance/balances';
import { CURRENCIES, type Cur } from '@/lib/finance/money';

export interface AccountRow {
  studentId: string;
  name: string;
  admissionNumber: string;
  className: string | null;
  status: string;
  boarding: string;
  balances: ByCurrency;
}

export interface AccountFilter { q?: string; classId?: string; owing?: boolean; fundId?: string; currency?: Cur; page?: number; pageSize?: number }

const VIEW: PermissionKey[] = ['finance.accounts.view', 'finance.payments.record', 'finance.payments.verify', 'finance.charges.create', 'finance.reports.view'];

export async function listAccounts(user: Actor, f: AccountFilter = {}) {
  need(user, ...VIEW);
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(5000, Math.max(1, f.pageSize ?? 50));
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const where: Prisma.StudentWhereInput = { schoolId: user.schoolId };
    if (f.classId) where.currentClassId = f.classId;
    if (f.q?.trim()) {
      const q = f.q.trim();
      where.OR = [{ fullName: { contains: q, mode: 'insensitive' } }, { admissionNumber: { contains: q, mode: 'insensitive' } }];
    }
    let known: Map<string, ByCurrency> | null = null;
    if (f.owing) {
      known = await balancesOf(tx, user.schoolId, { fundId: f.fundId, currency: f.currency });
      const ids = Array.from(known.entries()).filter(([, b]) => CURRENCIES.some((c) => (!f.currency || c === f.currency) && b[c].outstanding > 0)).map(([id]) => id);
      where.id = { in: ids };
    }
    const [total, students] = await Promise.all([
      tx.student.count({ where }),
      tx.student.findMany({ where, orderBy: [{ surname: 'asc' }, { firstName: 'asc' }, { admissionNumber: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, fullName: true, admissionNumber: true, status: true, boarding: true, currentClassId: true } }),
    ]);
    const balances = known ?? (await balancesOf(tx, user.schoolId, { studentIds: students.map((s) => s.id), fundId: f.fundId, currency: f.currency }));
    const classIds = Array.from(new Set(students.map((s) => s.currentClassId).filter((x): x is string => !!x)));
    const classes = classIds.length ? await tx.schoolClass.findMany({ where: { schoolId: user.schoolId, id: { in: classIds } }, select: { id: true, name: true } }) : [];
    const className = new Map(classes.map((c) => [c.id, c.name]));
    const rows: AccountRow[] = students.map((s) => ({
      studentId: s.id, name: s.fullName, admissionNumber: s.admissionNumber, className: s.currentClassId ? (className.get(s.currentClassId) ?? null) : null, status: s.status, boarding: s.boarding,
      balances: balances.get(s.id) ?? emptyByCurrency(),
    }));
    return { rows, total, page, pageSize };
  });
}

/** One student's account: header, balances per currency and fund, what is owed on each charge, credit on account and the statement. */
export async function getAccount(user: Actor, studentId: string) {
  need(user, ...VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({
      where: { id: studentId, schoolId: user.schoolId },
      select: {
        id: true, fullName: true, admissionNumber: true, status: true, boarding: true, currentClassId: true,
        guardians: { select: { isFeePayer: true, isPrimary: true, relationship: true, guardian: { select: { fullName: true, phone: true } } } },
      },
    });
    if (!s) throw new ServiceError('Student not found', 404);
    const [acct, klass, funds, terms] = await Promise.all([
      studentAccount(tx, user.schoolId, studentId),
      s.currentClassId ? tx.schoolClass.findFirst({ where: { id: s.currentClassId, schoolId: user.schoolId }, select: { name: true } }) : Promise.resolve(null),
      tx.fund.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true } }),
      tx.academicTerm.findMany({ where: { schoolId: user.schoolId }, select: { id: true, name: true, status: true } }),
    ]);
    const fundName = new Map(funds.map((f) => [f.id, f.name]));
    const termName = new Map(terms.map((t) => [t.id, t.name]));
    return {
      student: { id: s.id, name: s.fullName, admissionNumber: s.admissionNumber, status: s.status, boarding: s.boarding, className: klass?.name ?? null },
      payers: s.guardians.filter((g) => g.isFeePayer || g.isPrimary).map((g) => ({ name: g.guardian.fullName, phone: g.guardian.phone, relationship: g.relationship, isFeePayer: g.isFeePayer })),
      byCurrency: acct.byCurrency,
      byFund: acct.byFund.map((f) => ({ fundId: f.fundId, fundName: fundName.get(f.fundId) ?? '', byCurrency: f.byCurrency })),
      charges: acct.lines.map((l) => ({
        chargeId: l.chargeId, termId: l.termId, termName: termName.get(l.termId) ?? '', fundId: l.fundId, fundName: fundName.get(l.fundId) ?? '', description: l.description, currency: l.currency,
        chargedCents: l.charged, adjustedCents: l.adjusted, paidCents: l.paid, refundedCents: l.refunded, outstandingCents: l.outstanding,
      })),
      credits: acct.credits.map((c) => ({ paymentId: c.paymentId, receiptNumber: c.receiptNumber, fundId: c.fundId, fundName: fundName.get(c.fundId ?? '') ?? 'Any fund', currency: c.currency, creditCents: c.creditCents })),
      statement: acct.statement.map((e) => ({ ...e, fundName: fundName.get(e.fundId ?? '') ?? 'Any fund' })),
    };
  });
}
