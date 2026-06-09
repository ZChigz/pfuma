import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { canManageAssets } from '@/lib/permissions';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { UpdateAssetSchema } from '@/lib/validations/assets';
import type { SessionUser } from '@/types';

async function _GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const asset = await prisma.asset.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
    include: {
      category:    { select: { id: true, name: true } },
      maintenance: {
        orderBy: { maintenanceDate: 'desc' },
        include: { recorder: { select: { fullName: true } } },
      },
      disposal: {
        include: { recorder: { select: { fullName: true } } },
      },
    },
  });
  if (!asset) return apiNotFound('Asset');

  return apiSuccess({ asset });
}

async function _PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageAssets(user.role); } catch (res) { return res as Response; }

  const existing = await prisma.asset.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
  });
  if (!existing) return apiNotFound('Asset');

  const parsed = await parseBody(req, UpdateAssetSchema);
  if ('error' in parsed) return parsed.error;

  const asset = await prisma.$transaction(async (tx) => {
    const a = await tx.asset.update({
      where: { id: params.id },
      data: {
        ...(parsed.data.condition !== undefined ? { condition: parsed.data.condition }              : {}),
        ...(parsed.data.location  !== undefined ? { location:  parsed.data.location  }              : {}),
        ...(parsed.data.custodian !== undefined ? { custodian: parsed.data.custodian || null }       : {}),
        ...(parsed.data.status    !== undefined ? { status:    parsed.data.status    }              : {}),
        ...(parsed.data.imageUrl  !== undefined ? { imageUrl:  parsed.data.imageUrl  || null }      : {}),
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_ASSET',
        entityType: 'Asset',
        entityId:   a.id,
        detail:     `Updated ${a.name}`,
      },
      tx,
    );
    return a;
  });

  return apiSuccess({ asset: { ...asset, acquisitionCost: asset.acquisitionCost.toNumber() } });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET   = withApi('GET /api/assets/[id]',   _GET   as H);
export const PATCH = withApi('PATCH /api/assets/[id]', _PATCH as H);
