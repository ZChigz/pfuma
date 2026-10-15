import type { AuditAction, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ScopedDb } from '@/lib/scoped-db';
import type { TableQuery } from '@/lib/table-query';
import { EXPORT_LIMIT } from '@/lib/table-query';

export const AUDIT_SORTABLE = ['createdAt', 'action', 'entityType', 'actor'] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const AUDIT_FILTER_KEYS = {
  action: z.string().regex(/^[A-Z_]{3,60}$/),
  actor: z.string().min(1).max(60),
  entity: z.string().regex(/^[A-Za-z]{2,40}$/),
  from: dateOnly,
  to: dateOnly,
};

export function auditWhere(q: TableQuery): Prisma.AuditLogWhereInput {
  const f = q.filters;
  const where: Prisma.AuditLogWhereInput = {};
  if (f.action) where.action = f.action as AuditAction;
  if (f.actor) where.actorId = f.actor;
  if (f.entity) where.entityType = f.entity;
  if (f.from || f.to) {
    where.createdAt = {
      ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
      ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 864e5) } : {}),
    };
  }
  if (q.q) {
    where.OR = [
      { detail: { contains: q.q, mode: 'insensitive' } },
      { entityId: { equals: q.q } },
      { actor: { fullName: { contains: q.q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

const AUDIT_SELECT = {
  id: true, action: true, entityType: true, entityId: true, detail: true, before: true, after: true, createdAt: true,
  actor: { select: { id: true, fullName: true } },
} as const;

export async function listAuditLog(db: ScopedDb, q: TableQuery, opts: { all?: boolean } = {}) {
  const where = auditWhere(q);
  const dir = q.dir;
  const orderBy: Prisma.AuditLogOrderByWithRelationInput[] =
    q.sort === 'actor' ? [{ actor: { fullName: dir } }, { createdAt: 'desc' }]
    : q.sort === 'action' || q.sort === 'entityType' ? [{ [q.sort]: dir }, { createdAt: 'desc' }]
    : [{ createdAt: dir }, { id: 'desc' }];

  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where, orderBy, select: AUDIT_SELECT,
      ...(opts.all ? { take: EXPORT_LIMIT } : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    }),
  ]);
  return { total, rows };
}

/** Values for the filter drop-downs: actions that occur, entity types that occur, and the school's users. */
export async function auditFilterOptions(db: ScopedDb) {
  const [actions, entities, users] = await Promise.all([
    db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
    db.auditLog.groupBy({ by: ['entityType'], orderBy: { entityType: 'asc' } }),
    db.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
  ]);
  return { actions: actions.map((a) => a.action), entities: entities.map((e) => e.entityType), users };
}
