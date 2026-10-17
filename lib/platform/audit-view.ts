import { prisma } from '@/lib/prisma';

/** The console's own audit log, newest first. */
export async function listPlatformAudit(page: number, pageSize: number) {
  const [total, rows] = await Promise.all([
    prisma.platformAuditLog.count(),
    prisma.platformAuditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, action: true, schoolId: true, detail: true, ip: true, createdAt: true, admin: { select: { fullName: true } } },
    }),
  ]);
  const ids = Array.from(new Set(rows.map((r) => r.schoolId).filter((x): x is string => !!x)));
  const names = new Map((await prisma.school.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  return { total, rows: rows.map((r) => ({ ...r, schoolName: r.schoolId ? names.get(r.schoolId) ?? null : null })) };
}
