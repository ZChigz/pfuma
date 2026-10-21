// Public check of a printed receipt (the QR code). Shows only the school, receipt number, date, amount and whether it still stands: no names.
import { prisma } from '@/lib/prisma';
import { formatMoney, type Cur } from '@/lib/finance/money';
import { ymd } from '@/lib/finance/common';

export type ReceiptCheck = { valid: false } | { valid: true; school: string; receiptNumber: string; amount: string; date: string; voided: boolean };

export async function verifyReceipt(code: string): Promise<ReceiptCheck> {
  if (!/^[0-9A-F]{10}$/.test(code)) return { valid: false };
  const p = await prisma.finPayment.findFirst({ where: { verifyCode: code, status: 'VERIFIED' }, select: { schoolId: true, receiptNumber: true, amountCents: true, currency: true, receivedOn: true, voidRow: { select: { id: true } } } });
  if (!p?.receiptNumber) return { valid: false };
  const school = await prisma.school.findUnique({ where: { id: p.schoolId }, select: { name: true } });
  return { valid: true, school: school?.name ?? '', receiptNumber: p.receiptNumber, amount: formatMoney(p.amountCents, p.currency as Cur), date: ymd(p.receivedOn), voided: !!p.voidRow };
}
