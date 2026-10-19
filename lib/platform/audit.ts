// Everything done in the console is written here: who, what, which school, before and after. Append only.
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformAdminContext } from '@/lib/platform/session';

export interface PlatformAuditInput {
  action: string;
  schoolId?: string | null;
  entityType: string;
  entityId: string;
  detail?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

// A raw client or a transaction of it.
type Writer = { platformAuditLog: { create(args: { data: Prisma.PlatformAuditLogUncheckedCreateInput }): PromiseLike<unknown> } };

export async function logPlatform(admin: Pick<PlatformAdminContext, 'id' | 'ip' | 'userAgent'>, entry: PlatformAuditInput, db: Writer = prisma): Promise<void> {
  await db.platformAuditLog.create({
    data: {
      adminId: admin.id, action: entry.action, schoolId: entry.schoolId ?? null, entityType: entry.entityType, entityId: entry.entityId,
      detail: entry.detail, before: entry.before, after: entry.after, ip: admin.ip || null, userAgent: admin.userAgent || null,
    },
  });
}
