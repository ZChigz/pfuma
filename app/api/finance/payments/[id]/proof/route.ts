// A signed link to a payment's proof of payment that expires after a few minutes. The file is private; nobody opens it without this route.
import { UTApi } from 'uploadthing/server';
import { guarded } from '@/lib/finance/route';
import { ServiceError } from '@/lib/api';
import { getScopedDb } from '@/lib/scoped-db';
import { POP_URL_TTL, proofKeyBelongsTo } from '@/lib/proof-of-payment';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/finance/payments/[id]/proof', ['finance.payments.view', 'finance.payments.verify', 'finance.payments.record'], async ({ user, params }) => {
  const p = await getScopedDb(user.schoolId, user.id).finPayment.findFirst({ where: { id: params.id, schoolId: user.schoolId }, select: { proofKey: true } });
  if (!p?.proofKey || !proofKeyBelongsTo(p.proofKey, user.schoolId)) throw new ServiceError('Proof of payment not found', 404);
  const { ufsUrl } = await new UTApi().generateSignedURL(p.proofKey, { keyType: 'customId', expiresIn: POP_URL_TTL });
  return { url: ufsUrl, expiresIn: POP_URL_TTL };
});
