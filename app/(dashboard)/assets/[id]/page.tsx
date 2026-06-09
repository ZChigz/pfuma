import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import { AssetDetailClient } from '@/components/assets/AssetDetailClient';
import type { SessionUser } from '@/types';

export default async function AssetDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
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

  if (!asset) notFound();

  const categories = await prisma.assetCategory.findMany({
    where:   { schoolId: user.schoolId },
    select:  { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const serialized = {
    ...asset,
    acquisitionCost: asset.acquisitionCost.toNumber(),
    acquisitionDate: asset.acquisitionDate.toISOString(),
    createdAt:       asset.createdAt.toISOString(),
    maintenance: asset.maintenance.map((m) => ({
      ...m,
      cost:            m.cost?.toNumber() ?? null,
      maintenanceDate: m.maintenanceDate.toISOString(),
      nextServiceDate: m.nextServiceDate?.toISOString() ?? null,
      createdAt:       m.createdAt.toISOString(),
    })),
    disposal: asset.disposal
      ? {
          ...asset.disposal,
          proceeds:    asset.disposal.proceeds?.toNumber() ?? null,
          disposalDate: asset.disposal.disposalDate.toISOString(),
          createdAt:   asset.disposal.createdAt.toISOString(),
        }
      : null,
  };

  return (
    <AssetDetailClient
      asset={serialized}
      categories={categories}
      userRole={user.role}
    />
  );
}
