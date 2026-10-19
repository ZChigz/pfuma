import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';
import { canDisposeAsset } from '@/lib/permissions';
import { parseBody, apiSuccess, apiError, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { DisposeAssetSchema } from '@/lib/validations/assets';
import type { SessionUser } from '@/types';

async function _POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  try { await canDisposeAsset(user.role); } catch (res) { return res as Response; }

  const asset = await db.asset.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
  });
  if (!asset) return apiNotFound('Asset');
  if (asset.status === 'DISPOSED') return apiError('Asset is already disposed', 409);

  const parsed = await parseBody(req, DisposeAssetSchema);
  if ('error' in parsed) return parsed.error;

  const proceeds = parsed.data.proceeds ?? null;
  if (proceeds && !parsed.data.currency) return apiError('Choose the currency of the proceeds', 422);

  const disposal = await db.$tx(async (tx) => {
    const d = await tx.assetDisposal.create({
      data: {
        schoolId:     user.schoolId,
        assetId:      params.id,
        disposalDate: parsed.data.disposalDate,
        reason:       parsed.data.reason,
        method:       parsed.data.method,
        proceeds:     parsed.data.proceeds  ?? null,
        currency:     parsed.data.currency  ?? null,
        recordedBy:   user.id,
      },
    });
    await tx.asset.update({
      where: { id: params.id },
      data:  { status: 'DISPOSED' },
    });
    // Money received from the disposal is income, so it shows in the finance reports.
    if (proceeds && proceeds > 0 && parsed.data.currency) {
      const income = await tx.income.create({
        data: {
          source:          'ASSET_DISPOSAL',
          amount:          proceeds,
          currency:        parsed.data.currency,
          receivedOn:      parsed.data.disposalDate,
          description:     `Disposal of ${asset.name} (${asset.tagNumber}) — ${parsed.data.method.toLowerCase()}`,
          assetDisposalId: d.id,
          recordedById:    user.id,
        } as never,
      });
      await logAudit(
        {
          schoolId: user.schoolId, actorId: user.id, action: 'RECORD_INCOME', entityType: 'Income', entityId: income.id,
          detail: `${parsed.data.currency} ${proceeds} from disposing of ${asset.name}`,
        },
        tx,
      );
    }
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'DISPOSE_ASSET',
        entityType: 'Asset',
        entityId:   params.id,
        detail:     `${parsed.data.method} — ${parsed.data.reason}`,
      },
      tx,
    );
    return d;
  });

  return apiSuccess({
    disposal: { ...disposal, proceeds: disposal.proceeds?.toNumber() ?? null },
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/assets/[id]/dispose', _POST as H);
