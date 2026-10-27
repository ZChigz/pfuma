import { UTApi } from 'uploadthing/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { authorizeAny } from '@/lib/access';
import { POP_URL_TTL, proofKeyBelongsTo } from '@/lib/proof-of-payment';
import type { SessionUser } from '@/types';

// Returns a signed link to the payment's proof that expires after a few minutes.
// The file itself is private; nobody can open it without asking this route.
async function _GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  await authorizeAny(user, ['finance.payments.record', 'finance.payments.verify', 'finance.payments.void']);

  const payment = await db.payment.findUnique({
    where: { id: params.id, schoolId: user.schoolId },
    select: { popKey: true, popUrl: true },
  });
  if (!payment) return apiNotFound('Payment');

  // Older proofs were uploaded as public files before uploads became private.
  if (!payment.popKey) {
    return payment.popUrl ? apiSuccess({ url: payment.popUrl, expiresIn: null }) : apiNotFound('Proof of payment');
  }
  // Defence in depth: the key must carry this school's id.
  if (!proofKeyBelongsTo(payment.popKey, user.schoolId)) return apiNotFound('Proof of payment');

  const { ufsUrl } = await new UTApi().generateSignedURL(payment.popKey, {
    keyType: 'customId',
    expiresIn: POP_URL_TTL,
  });
  return apiSuccess({ url: ufsUrl, expiresIn: POP_URL_TTL });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET = withApi('GET /api/accounting/payments/[id]/proof', _GET as H);
