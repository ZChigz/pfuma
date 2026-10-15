import { prisma } from '@/lib/prisma';

// For the health check, which has no school or user to scope to.
export async function pingDb(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
