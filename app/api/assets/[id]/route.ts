import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { logAudit } from '@/lib/audit';
import { canManageAssets } from '@/lib/permissions';
import { resolveCustodian, sameCustodian } from '@/lib/assets';
import { parseBody, apiSuccess, apiUnauthorized, apiNotFound, withApi, apiError } from '@/lib/api';
import { UpdateAssetSchema } from '@/lib/validations/assets';
import type { SessionUser } from '@/types';

async function _GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);

  const asset = await db.asset.findFirst({
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
      transfers: {
        orderBy: { transferDate: 'desc' },
        include: { recordedBy: { select: { fullName: true } }, fromCustodian: { select: { fullName: true } }, toCustodian: { select: { fullName: true } } },
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
  const db = getScopedDb(user.schoolId, user.id);

  try { await canManageAssets(user.role); } catch (res) { return res as Response; }

  const existing = await db.asset.findFirst({
    where: { id: params.id, schoolId: user.schoolId },
  });
  if (!existing) return apiNotFound('Asset');

  const parsed = await parseBody(req, UpdateAssetSchema);
  if ('error' in parsed) return parsed.error;

  // A change of location or custodian is a transfer: it keeps the old values in the asset's history.
  const movingLocation = parsed.data.location !== undefined && parsed.data.location !== existing.location;
  const wantsCustodian = parsed.data.custodian !== undefined || parsed.data.custodianId !== undefined;
  let nextWho = { custodianId: existing.custodianId, custodian: existing.custodian };
  if (wantsCustodian) {
    const resolved = await resolveCustodian(db, { custodianId: parsed.data.custodianId, custodian: parsed.data.custodian });
    if (!resolved) return apiNotFound('Custodian');
    nextWho = resolved;
  }
  const movingCustodian = wantsCustodian && !sameCustodian({ custodianId: existing.custodianId, custodian: existing.custodian }, nextWho);
  if ((movingLocation || movingCustodian) && existing.status === 'DISPOSED') {
    return apiError('A disposed asset cannot be moved', 409);
  }

  const asset = await db.$tx(async (tx) => {
    const a = await tx.asset.update({
      where: { id: params.id },
      data: {
        ...(parsed.data.condition !== undefined ? { condition: parsed.data.condition }              : {}),
        ...(parsed.data.location  !== undefined ? { location:  parsed.data.location  }              : {}),
        ...(wantsCustodian ? { custodian: nextWho.custodian, custodianId: nextWho.custodianId } : {}),
        ...(parsed.data.status    !== undefined ? { status:    parsed.data.status    }              : {}),
        ...(parsed.data.imageUrl  !== undefined ? { imageUrl:  parsed.data.imageUrl  || null }      : {}),
      },
    });
    if (movingLocation || movingCustodian) {
      await tx.assetTransfer.create({
        data: {
          assetId:           params.id,
          fromLocation:      existing.location,
          toLocation:        a.location,
          fromCustodianId:   existing.custodianId,
          toCustodianId:     a.custodianId,
          fromCustodianName: existing.custodian,
          toCustodianName:   a.custodian,
          transferDate:      parsed.data.transferDate ? new Date(parsed.data.transferDate) : new Date(),
          note:              parsed.data.transferNote || null,
          recordedById:      user.id,
        } as never,
      });
      await logAudit(
        {
          schoolId: user.schoolId, actorId: user.id, action: 'TRANSFER_ASSET', entityType: 'Asset', entityId: a.id,
          detail: `${a.name}: ${existing.location} (${existing.custodian ?? 'no custodian'}) → ${a.location} (${a.custodian ?? 'no custodian'})`,
        },
        tx,
      );
    }
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
