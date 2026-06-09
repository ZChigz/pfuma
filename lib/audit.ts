import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface AuditParams {
  schoolId: string;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  detail?: string;
}

// tx is separate so the call site is explicit about whether it is inside a
// $transaction. A failed audit write intentionally propagates — it should
// roll back the whole operation, not be silently swallowed.
export async function logAudit(
  params: AuditParams,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.auditLog.create({ data: params });
}
