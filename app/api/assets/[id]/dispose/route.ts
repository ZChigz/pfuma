import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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

  try { await canDisposeAsset(user.role); } catch (res) { return res as Response; }

  const asset = await prisma.asset.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
  });
  if (!asset) return apiNotFound('Asset');
  if (asset.status === 'DISPOSED') return apiError('Asset is already disposed', 409);

  const parsed = await parseBody(req, DisposeAssetSchema);
  if ('error' in parsed) return parsed.error;

  const disposal = await prisma.$transaction(async (tx) => {
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
