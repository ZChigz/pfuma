import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface AuditParams {
  schoolId: string;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  detail?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

// Anything with an auditLog delegate: the raw client, a transaction, or the
// school-scoped client / transaction from lib/scoped-db.ts.
export interface AuditClient {
  auditLog: { create(args: { data: AuditParams }): PromiseLike<unknown> };
}

// Business-level entries ("Verified payment", "Published results"). Row-level
// before/after history for the core tables is written by the database trigger
// audit_row_change (migration 20261017000200), not here.
//
// `db` is separate so the call site is explicit about whether it is inside a
// transaction. A failed audit write intentionally propagates — it should roll
// back the whole operation, not be silently swallowed.
export async function logAudit(params: AuditParams, db?: AuditClient): Promise<void> {
  const client: AuditClient = db ?? (prisma as unknown as AuditClient);
  await client.auditLog.create({ data: params });
}
