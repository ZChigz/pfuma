import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { AssetsClient } from '@/components/assets/AssetsClient';
import type { SessionUser } from '@/types';

function getTermStart(now: Date): Date {
  const month = now.getMonth();
  const termStartMonth = month < 4 ? 0 : month < 8 ? 4 : 8;
  return new Date(now.getFullYear(), termStartMonth, 1);
}

export default async function AssetsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const user = session.user as unknown as SessionUser;
  const { schoolId, role } = user;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    activeCount,
    maintenanceCount,
    disposedThisTerm,
    overdueRaw,
    categories,
    assetsRaw,
  ] = await Promise.all([
    prisma.asset.count({ where: { schoolId, status: 'ACTIVE' } }),
    prisma.asset.count({ where: { schoolId, status: 'UNDER_MAINTENANCE' } }),
    prisma.asset.count({
      where: {
        schoolId,
        status: 'DISPOSED',
        disposal: { disposalDate: { gte: getTermStart(today) } },
      },
    }),
    prisma.assetMaintenance.findMany({
      where: {
        schoolId,
        nextServiceDate: { lt: today },
        asset: { status: { not: 'DISPOSED' } },
      },
      select: {
        nextServiceDate: true,
        asset: { select: { id: true, name: true, tagNumber: true } },
      },
      orderBy: { nextServiceDate: 'asc' },
      distinct:  ['assetId'],
    }),
    prisma.assetCategory.findMany({
      where: { schoolId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.asset.findMany({
      where: { schoolId },
      include: {
        category: { select: { name: true } },
        _count:   { select: { maintenance: true } },
        disposal: { select: { id: true, method: true, disposalDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const assets = assetsRaw.map((a) => ({
    ...a,
    acquisitionCost: a.acquisitionCost.toNumber(),
    acquisitionDate: a.acquisitionDate.toISOString(),
    createdAt:       a.createdAt.toISOString(),
    disposal: a.disposal
      ? { ...a.disposal, disposalDate: a.disposal.disposalDate.toISOString() }
      : null,
  }));

  const overdueAssets = overdueRaw.map((o) => ({
    assetId:         o.asset.id,
    name:            o.asset.name,
    tagNumber:       o.asset.tagNumber,
    nextServiceDate: o.nextServiceDate!.toISOString(),
  }));

  return (
    <AssetsClient
      initialAssets={assets}
      categories={categories}
      stats={{ activeCount, maintenanceCount, disposedThisTerm }}
      overdueAssets={overdueAssets}
      userRole={role}
    />
  );
}
