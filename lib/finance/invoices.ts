// Invoices: a fee statement for a learner or a whole family, numbered from the school's invoice format, with the figures kept as a snapshot
// so a reprint shows what the guardian was given. Raising one changes no balance.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, idSchema, need, type Actor } from '@/lib/finance/common';
import { buildStatement, statementText, type StatementView } from '@/lib/finance/statements';
import { feePayerContacts, queueSms } from '@/lib/finance/sms';
import { DEFAULT_INVOICE_FORMAT, formatNumber } from '@/lib/numbering';
import { CURRENCIES } from '@/lib/finance/money';

export const InvoiceSchema = z.object({ studentId: idSchema.optional(), guardianId: idSchema.optional(), classId: idSchema.optional(), termId: idSchema })
  .refine((v) => [v.studentId, v.guardianId, v.classId].filter(Boolean).length === 1, 'Choose a learner, a family or a class');

export interface InvoiceData { number: string; issuedOn: string; termName: string; statements: StatementView[] }

/** Takes the next invoice number under a row lock. */
async function nextInvoiceNumber(tx: Db, schoolId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ invoiceFormat: string | null; invoiceNextNumber: number; schoolCode: string }[]>`SELECT "invoiceFormat", "invoiceNextNumber", "schoolCode" FROM "School" WHERE "id" = ${schoolId} FOR UPDATE`;
  const s = rows[0];
  if (!s) throw new ServiceError('School not found', 404);
  const n = s.invoiceNextNumber;
  const number = formatNumber(s.invoiceFormat || DEFAULT_INVOICE_FORMAT, { year: new Date().getFullYear(), schoolCode: s.schoolCode }, n);
  await tx.$executeRaw`UPDATE "School" SET "invoiceNextNumber" = ${n + 1} WHERE "id" = ${schoolId}`;
  return number;
}

async function raise(tx: Db, user: Actor, termId: string, studentIds: string[], target: { studentId?: string; guardianId?: string }) {
  const term = await tx.academicTerm.findFirst({ where: { id: termId, schoolId: user.schoolId }, select: { name: true } });
  if (!term) throw new ServiceError('Term not found', 404);
  const statements: StatementView[] = [];
  for (const id of studentIds) statements.push(await buildStatement(tx, user.schoolId, id, termId));
  const number = await nextInvoiceNumber(tx, user.schoolId);
  const data: InvoiceData = { number, issuedOn: new Date().toISOString().slice(0, 10), termName: term.name, statements };
  const inv = await tx.invoice.create({ data: { schoolId: user.schoolId, number, studentId: target.studentId ?? null, guardianId: target.guardianId ?? null, termId, data: data as never, createdById: user.id } });
  await audit(tx, user, 'CREATE_INVOICE', 'Invoice', inv.id, `Raised invoice ${number}`, undefined, { number, termId, studentIds });
  return { id: inv.id, number };
}

/** One invoice for a learner, for a family (all the guardian's children on one document), or one per learner for a class (a pack). */
export async function createInvoices(user: Actor, rawIn: unknown) {
  need(user, 'finance.statements.view', 'finance.billing.run');
  const input = InvoiceSchema.parse(rawIn);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (input.studentId) {
      if (!(await tx.student.findFirst({ where: { id: input.studentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Student not found', 404);
      return [await raise(tx, user, input.termId, [input.studentId], { studentId: input.studentId })];
    }
    if (input.guardianId) {
      const kids = (await tx.studentGuardian.findMany({ where: { guardianId: input.guardianId, student: { schoolId: user.schoolId } }, select: { studentId: true } })).map((k) => k.studentId);
      if (kids.length === 0) throw new ServiceError('Guardian not found', 404);
      return [await raise(tx, user, input.termId, kids, { guardianId: input.guardianId })];
    }
    const ids = (await tx.student.findMany({ where: { schoolId: user.schoolId, currentClassId: input.classId, status: 'ACTIVE' } as never, select: { id: true }, take: 400 })).map((s) => s.id);
    if (ids.length === 0) throw new ServiceError('There are no learners in that class', 404);
    const out = [];
    for (const id of ids) out.push(await raise(tx, user, input.termId, [id], { studentId: id }));
    return out;
  });
}

export async function getInvoice(user: Actor, id: string): Promise<{ id: string; createdAt: string; data: InvoiceData; studentId: string | null; guardianId: string | null }> {
  need(user, 'finance.statements.view', 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!inv) throw new ServiceError('Invoice not found', 404);
    return { id: inv.id, createdAt: inv.createdAt.toISOString(), data: inv.data as unknown as InvoiceData, studentId: inv.studentId, guardianId: inv.guardianId };
  });
}

export async function listInvoices(user: Actor, f: { studentId?: string; termId?: string } = {}) {
  need(user, 'finance.statements.view', 'finance.accounts.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.invoice.findMany({ where: { schoolId: user.schoolId, ...(f.studentId ? { studentId: f.studentId } : {}), ...(f.termId ? { termId: f.termId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: r.id, number: r.number, studentId: r.studentId, guardianId: r.guardianId, termId: r.termId, createdAt: r.createdAt.toISOString() }));
  });
}

/** Texts the fee payer the amount owed, with the pay link when Paynow is on (the link is added by the caller through `link`). */
export async function sendInvoiceSms(user: Actor, id: string, link?: string) {
  need(user, 'finance.statements.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!inv) throw new ServiceError('Invoice not found', 404);
    const data = inv.data as unknown as InvoiceData;
    const first = data.statements[0];
    if (!first) throw new ServiceError('Empty invoice', 409);
    const studentId = inv.studentId ?? first.student.id;
    const contacts = await feePayerContacts(tx, user.schoolId, studentId);
    if (contacts.length === 0) throw new ServiceError('No guardian with a phone number to send to', 409);
    const total = { USD: 0, ZIG: 0 };
    for (const s of data.statements) for (const c of CURRENCIES) total[c] += s.closing[c];
    const body = `${statementText(first.school.name, data.statements.length > 1 ? 'your children' : first.student.fullName, total)} Invoice ${data.number}.${link ? ` Pay online: ${link}` : ''}`;
    return { queued: await queueSms(tx, user.schoolId, contacts, body, { studentId, key: `invoice:${id}` }) };
  });
}
