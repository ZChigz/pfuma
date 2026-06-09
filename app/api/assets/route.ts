import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { canManageAssets } from '@/lib/permissions';
import { parseBody, apiSuccess, apiUnauthorized, withApi } from '@/lib/api';
import { CreateAssetSchema } from '@/lib/validations/assets';
import type { SessionUser } from '@/types';

async function _GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  const { searchParams } = req.nextUrl;
  const category  = searchParams.get('category')  || undefined;
  const condition = searchParams.get('condition')  || undefined;
  const status    = searchParams.get('status')     || undefined;
  const q         = searchParams.get('q')          || undefined;

  const assets = await prisma.asset.findMany({
    where: {
      schoolId: user.schoolId,
      ...(category  ? { categoryId: category }         : {}),
      ...(condition ? { condition: condition as never } : {}),
      ...(status    ? { status: status as never }       : {}),
      ...(q ? {
        OR: [
          { name:      { contains: q, mode: 'insensitive' } },
          { tagNumber: { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
    },
    include: {
      category: { select: { name: true } },
      _count:   { select: { maintenance: true } },
      disposal: { select: { id: true, method: true, disposalDate: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return apiSuccess({ assets });
}

async function _POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageAssets(user.role); } catch (res) { return res as Response; }

  const parsed = await parseBody(req, CreateAssetSchema);
  if ('error' in parsed) return parsed.error;

  const asset = await prisma.$transaction(async (tx) => {
    const a = await tx.asset.create({
      data: {
        schoolId:        user.schoolId,
        name:            parsed.data.name,
        categoryId:      parsed.data.categoryId,
        description:     parsed.data.description   || null,
        tagNumber:       parsed.data.tagNumber,
        acquisitionDate: parsed.data.acquisitionDate,
        acquisitionCost: parsed.data.acquisitionCost,
        currency:        parsed.data.currency,
        location:        parsed.data.location,
        custodian:       parsed.data.custodian      || null,
        condition:       parsed.data.condition,
        imageUrl:        parsed.data.imageUrl       || null,
      },
    });
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_ASSET',
        entityType: 'Asset',
        entityId:   a.id,
        detail:     `${a.name} (${a.tagNumber})`,
      },
      tx,
    );
    return a;
  });

  return apiSuccess(
    { asset: { ...asset, acquisitionCost: asset.acquisitionCost.toNumber() } },
    201,
  );
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const GET  = withApi('GET /api/assets',  _GET  as H);
export const POST = withApi('POST /api/assets', _POST as H);
