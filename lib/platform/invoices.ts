// Pfuma's invoices to a school. Created and marked paid in the console; the school only reads them.
import type { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { logPlatform } from '@/lib/platform/audit';
import type { PlatformAdminContext } from '@/lib/platform/session';
import { prisma } from '@/lib/prisma';
import type { CreateInvoiceSchema } from '@/lib/validations/platform';

const date = (v: string) => new Date(`${v}T00:00:00.000Z`);
const today = () => new Date().toISOString().slice(0, 10);

/** PFU-2026-0001: one running number per year, across all schools. */
async function nextNumber(tx: Pick<typeof prisma, 'subscriptionInvoice'>, year: number): Promise<string> {
  const last = await tx.subscriptionInvoice.findFirst({ where: { number: { startsWith: `PFU-${year}-` } }, orderBy: { number: 'desc' }, select: { number: true } });
  const n = last ? Number(last.number.slice(-4)) + 1 : 1;
  return `PFU-${year}-${String(n).padStart(4, '0')}`;
}

export async function createInvoice(admin: PlatformAdminContext, schoolId: string, input: z.output<typeof CreateInvoiceSchema>) {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true } });
  if (!school) throw new ServiceError('School not found', 404);
  const issuedOn = input.issuedOn ?? today();

  // Two people raising an invoice at once can pick the same number; the unique index refuses the second, so try again.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx, Number(issuedOn.slice(0, 4)));
        const invoice = await tx.subscriptionInvoice.create({
          data: {
            schoolId, number, issuedOn: date(issuedOn), dueOn: input.dueOn ? date(input.dueOn) : null, amount: input.amount.toFixed(2),
            currency: input.currency, description: input.description, createdByAdminId: admin.id,
          },
        });
        await logPlatform(admin, {
          action: 'INVOICE_CREATED', schoolId, entityType: 'SubscriptionInvoice', entityId: invoice.id,
          detail: `${number} for ${school.name}: ${input.currency} ${input.amount.toFixed(2)}`,
          after: { number, amount: input.amount.toFixed(2), currency: input.currency, description: input.description, issuedOn, dueOn: input.dueOn ?? null },
        }, tx);
        return invoice;
      });
    } catch (e) {
      if (attempt < 3 && e instanceof Error && /Unique constraint|number/.test(e.message)) continue;
      throw e;
    }
  }
}

export async function markInvoicePaid(admin: PlatformAdminContext, invoiceId: string, paidOn = today()) {
  const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId }, include: { school: { select: { name: true } } } });
  if (!invoice) throw new ServiceError('Invoice not found', 404);
  if (invoice.status === 'PAID') throw new ServiceError('This invoice is already paid', 409);
  if (invoice.status === 'VOID') throw new ServiceError('A cancelled invoice cannot be paid', 409);
  return prisma.$transaction(async (tx) => {
    const paid = await tx.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidOn: date(paidOn) } });
    await logPlatform(admin, {
      action: 'INVOICE_PAID', schoolId: invoice.schoolId, entityType: 'SubscriptionInvoice', entityId: invoiceId,
      detail: `${invoice.number} for ${invoice.school.name} paid on ${paidOn}`, before: { status: 'OPEN' }, after: { status: 'PAID', paidOn },
    }, tx);
    return paid;
  });
}
