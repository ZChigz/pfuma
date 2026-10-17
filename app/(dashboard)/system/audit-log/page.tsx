import { getAccess } from '@/lib/access';
import { getScopedDb } from '@/lib/scoped-db';
import { parseTableQuery } from '@/lib/table-query';
import { AUDIT_FILTER_KEYS, AUDIT_SORTABLE, auditFilterOptions, listAuditLog } from '@/lib/system/audit-log';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { AuditLogClient } from '@/components/system/AuditLogClient';

export const metadata = { title: 'Audit Log · Pfuma' };

export default async function AuditLogPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { user, can } = await getAccess();
  if (!can('system.audit.view')) return <AccessDenied />;
  const db = getScopedDb(user.schoolId, user.id);

  const q = parseTableQuery(searchParams, { sortable: AUDIT_SORTABLE, filterKeys: AUDIT_FILTER_KEYS, defaultSort: 'createdAt', defaultDir: 'desc' });
  const [{ total, rows }, options] = await Promise.all([listAuditLog(db, q), auditFilterOptions(db)]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader
        title="Audit Log"
        description="Who did what, and when. Entries cannot be edited or deleted by anyone, and are kept for at least 7 years."
        breadcrumbs={[{ label: 'Dashboard & System' }, { label: 'Audit Log' }]}
      />
      <AuditLogClient
        rows={rows.map((r) => ({
          id: r.id, action: r.action, module: r.module, entityType: r.entityType, entityId: r.entityId, detail: r.detail,
          before: r.before, after: r.after, ip: r.ip, userAgent: r.userAgent, createdAt: r.createdAt.toISOString(), actorName: r.actor.fullName,
        }))}
        total={total}
        page={q.page}
        pageSize={q.pageSize}
        actions={options.actions}
        modules={options.modules}
        users={options.users}
        canExport={can('system.audit.export')}
      />
    </div>
  );
}
