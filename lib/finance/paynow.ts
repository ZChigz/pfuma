// Paynow: a guardian pays online from the portal. The attempt is stored first; Paynow answers with a page to send the guardian to and, later, a
// result by callback and by polling. Both are checked against the hash made with the school's integration key before any money is recorded.
// The payment is recorded and verified by the school's hidden system user (the gateway is the confirmation), then settles the oldest charges.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { supportUser } from '@/lib/platform/support';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { audit, centsSchema, currencySchema, assertCurrencyOn, dayOf, loadFinSettings, nextReceiptNumber, nextSerial, todayInHarare, type Actor } from '@/lib/finance/common';
import { verifyPaymentTx } from '@/lib/finance/payments';
import { formatMoney, type Cur } from '@/lib/finance/money';

const INITIATE_URL = 'https://www.paynow.co.zw/interface/initiatetransaction';
const newVerifyCode = () => randomBytes(5).toString('hex').toUpperCase();

/** Paynow's hash: every value in the order sent, joined with nothing, then the integration key; SHA-512, upper case. */
export function paynowHash(values: string[], key: string): string {
  return createHash('sha512').update(values.join('') + key).digest('hex').toUpperCase();
}

function hashOk(fields: URLSearchParams, key: string): boolean {
  const got = (fields.get('hash') ?? '').toUpperCase();
  if (!got) return false;
  const values: string[] = [];
  fields.forEach((v, k) => { if (k.toLowerCase() !== 'hash') values.push(v); });
  const want = paynowHash(values, key);
  const a = Buffer.from(got); const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const systemActor = async (schoolId: string): Promise<Actor> => {
  const u = await supportUser(schoolId);
  return { id: u.id, schoolId, role: 'ADMIN', grants: [], fullName: 'Paynow' };
};

export const StartSchema = z.object({ currency: currencySchema, amount: centsSchema, email: z.string().trim().email().max(120).optional(), phone: z.string().trim().max(20).optional() });

/** Starts a payment for a learner (the portal has already checked the token). Returns where to send the guardian. */
export async function startPaynow(schoolId: string, studentId: string, raw: unknown, origin: string) {
  const input = StartSchema.parse(raw);
  const db = getScopedDb(schoolId);
  const settings = await db.$tx((tx) => loadFinSettings(tx, schoolId));
  if (!settings.paynowEnabled || !settings.paynowId || !settings.paynowKey) throw new ServiceError('Online payment is not set up for this school', 409);
  await db.$tx((tx) => assertCurrencyOn(tx, schoolId, input.currency));
  const student = await db.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true, fullName: true } });
  if (!student) throw new ServiceError('Student not found', 404);
  const reference = `PFM-${randomBytes(6).toString('hex').toUpperCase()}`;
  const attempt = await db.paynowAttempt.create({ data: { schoolId, studentId, reference, currency: input.currency, amountCents: input.amount } });
  const amount = (input.amount / 100).toFixed(2);
  const fields: [string, string][] = [
    ['id', settings.paynowId], ['reference', reference], ['amount', amount], ['additionalinfo', `School fees: ${student.fullName}`],
    ['returnurl', `${origin}/api/portal/paynow/return?ref=${reference}`], ['resulturl', `${origin}/api/portal/paynow/callback`], ['authemail', input.email ?? ''], ['status', 'Message'],
  ];
  const form = new URLSearchParams(fields);
  form.set('hash', paynowHash(fields.map(([, v]) => v), settings.paynowKey));
  let reply: URLSearchParams;
  try {
    const res = await fetch(INITIATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(15_000) });
    reply = new URLSearchParams(await res.text());
  } catch {
    await db.paynowAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
    throw new ServiceError('Paynow could not be reached. Try again in a moment.', 502);
  }
  if ((reply.get('status') ?? '').toLowerCase() !== 'ok' || !hashOk(reply, settings.paynowKey)) {
    await db.paynowAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED' } });
    throw new ServiceError(reply.get('error') || 'Paynow did not accept the payment', 502);
  }
  await db.paynowAttempt.update({ where: { id: attempt.id }, data: { status: 'SENT', pollUrl: reply.get('pollurl') } });
  return { reference, redirectUrl: reply.get('browserurl') as string };
}

/** Records the confirmed payment once, verifies it as the system user and lets it settle charges. Safe to call again for the same attempt. */
async function settle(schoolId: string, reference: string, paynowRef: string) {
  const sys = await systemActor(schoolId);
  return getScopedDb(schoolId, sys.id).$tx(async (tx: Db) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PaynowAttempt" WHERE "schoolId" = ${schoolId} AND "reference" = ${reference} FOR UPDATE`;
    if (rows.length === 0) throw new ServiceError('Unknown Paynow reference', 404);
    const a = await tx.paynowAttempt.findFirstOrThrow({ where: { id: rows[0]!.id, schoolId } });
    if (a.paymentId) return { paymentId: a.paymentId, already: true };
    await assertCurrencyOn(tx, schoolId, a.currency as Cur);
    const today = todayInHarare();
    const year = Number(today.slice(0, 4));
    const ack = await nextSerial(tx, schoolId, year, 'ACK');
    const p = await tx.finPayment.create({
      data: {
        schoolId, studentId: a.studentId, guardianId: a.guardianId, fundId: null, receiptNumber: null, ackNumber: ack, verifyCode: newVerifyCode(), currency: a.currency, amountCents: a.amountCents,
        method: 'PAYNOW', reference: paynowRef || reference, paidBy: 'Paynow', receivedOn: dayOf(today), note: `Online payment ${reference}`, status: 'PENDING', recordedById: sys.id,
      },
    });
    await audit(tx, sys, 'PAYNOW_PAYMENT', 'FinPayment', p.id, `Paynow payment ${reference} of ${formatMoney(a.amountCents, a.currency as Cur)} confirmed`, undefined, {
      reference, paynowReference: paynowRef, studentId: a.studentId, currency: a.currency, amountCents: a.amountCents,
    });
    const v = await verifyPaymentTx(tx, sys, p.id, { gateway: true });
    await tx.paynowAttempt.update({ where: { id: a.id }, data: { status: 'PAID', paymentId: p.id } });
    return { paymentId: p.id, already: false, receiptNumber: v.receiptNumber };
  });
}

const PAID = new Set(['paid', 'delivered']);

/** The result Paynow posts to our result URL. Unsigned or wrongly signed posts are refused. */
export async function paynowCallback(form: URLSearchParams) {
  const reference = form.get('reference') ?? '';
  const a = await prisma.paynowAttempt.findUnique({ where: { reference }, select: { schoolId: true, amountCents: true } });
  if (!a) throw new ServiceError('Unknown reference', 404);
  const settings = await getScopedDb(a.schoolId).$tx((tx) => loadFinSettings(tx, a.schoolId));
  if (!settings.paynowKey || !hashOk(form, settings.paynowKey)) throw new ServiceError('Bad signature', 400);
  return applyResult(a.schoolId, reference, form, a.amountCents);
}

async function applyResult(schoolId: string, reference: string, f: URLSearchParams, amountCents: number) {
  const status = (f.get('status') ?? '').toLowerCase();
  if (PAID.has(status)) {
    const paid = Math.round(Number(f.get('amount') ?? '0') * 100);
    if (paid < amountCents) throw new ServiceError('Paynow reports a smaller amount than was asked for', 409);
    return settle(schoolId, reference, f.get('paynowreference') ?? '');
  }
  await prisma.paynowAttempt.updateMany({ where: { schoolId, reference, paymentId: null }, data: { status: status === 'cancelled' || status === 'failed' ? status.toUpperCase() : 'SENT' } });
  return { paymentId: null as string | null, already: false };
}

/** Asks Paynow where a payment stands (the guardian came back, or the callback was lost). */
export async function pollPaynow(reference: string) {
  const a = await prisma.paynowAttempt.findUnique({ where: { reference } });
  if (!a) throw new ServiceError('Unknown reference', 404);
  if (a.paymentId) return { status: 'PAID', paymentId: a.paymentId };
  if (!a.pollUrl) return { status: a.status, paymentId: null };
  const settings = await getScopedDb(a.schoolId).$tx((tx) => loadFinSettings(tx, a.schoolId));
  if (!settings.paynowKey) return { status: a.status, paymentId: null };
  let f: URLSearchParams;
  try {
    const res = await fetch(a.pollUrl, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    f = new URLSearchParams(await res.text());
  } catch {
    return { status: a.status, paymentId: null };
  }
  if (!hashOk(f, settings.paynowKey)) return { status: a.status, paymentId: null };
  const r = await applyResult(a.schoolId, reference, f, a.amountCents);
  return { status: r.paymentId ? 'PAID' : (f.get('status') ?? a.status).toUpperCase(), paymentId: r.paymentId };
}
