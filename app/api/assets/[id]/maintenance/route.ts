import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { canManageAssets } from '@/lib/permissions';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi } from '@/lib/api';
import { CreateMaintenanceSchema } from '@/lib/validations/assets';
import type { SessionUser } from '@/types';

async function _POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageAssets(user.role); } catch (res) { return res as Response; }

  const asset = await prisma.asset.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
  });
  if (!asset) return apiNotFound('Asset');

  const parsed = await parseBody(req, CreateMaintenanceSchema);
  if ('error' in parsed) return parsed.error;

  const maintenance = await prisma.$transaction(async (tx) => {
    const m = await tx.assetMaintenance.create({
      data: {
        schoolId:        user.schoolId,
        assetId:         params.id,
        maintenanceDate: parsed.data.maintenanceDate,
        description:     parsed.data.description,
        cost:            parsed.data.cost            ?? null,
        currency:        parsed.data.currency        ?? null,
        provider:        parsed.data.provider        ?? null,
        nextServiceDate: parsed.data.nextServiceDate ?? null,
        recordedBy:      user.id,
      },
    });
    if (asset.status === 'ACTIVE') {
      await tx.asset.update({
        where: { id: params.id },
        data:  { status: 'UNDER_MAINTENANCE' },
      });
    }
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'UPDATE_ASSET',
        entityType: 'Asset',
        entityId:   params.id,
        detail:     'Maintenance logged',
      },
      tx,
    );
    return m;
  });

  return apiSuccess(
    { maintenance: { ...maintenance, cost: maintenance.cost?.toNumber() ?? null } },
    201,
  );
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/assets/[id]/maintenance', _POST as H);
