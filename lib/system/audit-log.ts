import type { AuditAction, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ScopedDb } from '@/lib/scoped-db';
import type { TableQuery } from '@/lib/table-query';
import { EXPORT_LIMIT } from '@/lib/table-query';

// The audit log is append-only (a database trigger refuses any change or delete) and entries are
// kept for at least this long. Nothing in the app deletes them; if archiving is ever added it must
// leave anything younger than this.
export const AUDIT_RETENTION_YEARS = 7;

export const AUDIT_SORTABLE = ['createdAt', 'action', 'module', 'actor'] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const AUDIT_FILTER_KEYS = {
  action: z.string().regex(/^[A-Z_]{3,60}$/),
  /** Entries made by this person. */
  actor: z.string().min(1).max(60),
  /** Entries made by this person or about them (the "view activity" link on the Users page). */
  user: z.string().min(1).max(60),
  module: z.string().regex(/^[a-z]{2,20}$/),
  entity: z.string().regex(/^[A-Za-z]{2,40}$/),
  from: dateOnly,
  to: dateOnly,
};

export function auditWhere(q: TableQuery): Prisma.AuditLogWhereInput {
  const f = q.filters;
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.action) and.push({ action: f.action as AuditAction });
  if (f.actor) and.push({ actorId: f.actor });
  if (f.user) and.push({ OR: [{ actorId: f.user }, { entityType: 'User', entityId: f.user }] });
  if (f.module) and.push({ module: f.module });
  if (f.entity) and.push({ entityType: f.entity });
  if (f.from || f.to) {
    and.push({
      createdAt: {
        ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
        ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 864e5) } : {}),
      },
    });
  }
  if (q.q) {
    // The name of the record is in the detail ("Tendai Moyo (Teacher)"); an id also works.
    and.push({
      OR: [
        { detail: { contains: q.q, mode: 'insensitive' } },
        { entityId: { equals: q.q } },
        { entityType: { contains: q.q, mode: 'insensitive' } },
        { actor: { fullName: { contains: q.q, mode: 'insensitive' } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const AUDIT_SELECT = {
  id: true, action: true, module: true, entityType: true, entityId: true, detail: true, before: true, after: true,
  ip: true, userAgent: true, createdAt: true,
  actor: { select: { id: true, fullName: true } },
} as const;

export async function listAuditLog(db: ScopedDb, q: TableQuery, opts: { all?: boolean } = {}) {
  const where = auditWhere(q);
  const dir = q.dir;
  const orderBy: Prisma.AuditLogOrderByWithRelationInput[] =
    q.sort === 'actor' ? [{ actor: { fullName: dir } }, { createdAt: 'desc' }]
    : q.sort === 'action' || q.sort === 'module' ? [{ [q.sort]: dir }, { createdAt: 'desc' }]
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

/** Values for the filter drop-downs: actions and modules that occur, and the school's users. */
export async function auditFilterOptions(db: ScopedDb) {
  const [actions, modules, users] = await Promise.all([
    db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } }),
    db.auditLog.groupBy({ by: ['module'], orderBy: { module: 'asc' } }),
    db.user.findMany({ where: { isSupport: false }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } }),
  ]);
  return { actions: actions.map((a) => a.action), modules: modules.map((m) => m.module).filter((m): m is string => !!m), users };
}
