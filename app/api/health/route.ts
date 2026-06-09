import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      { success: true,  data: { status: 'ok',       timestamp, dbConnected: true  } },
      { status: 200 },
    );
  } catch (err) {
    logger.error('Health check: database connection failed', err);

    return Response.json(
      { success: false, data: { status: 'degraded', timestamp, dbConnected: false } },
      { status: 503 },
    );
  }
}
