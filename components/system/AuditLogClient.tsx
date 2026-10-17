'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { cn, formatDateTime } from '@/lib/utils';
import { actionLabel, diffValues, entityLabel, moduleLabel, recordHref } from '@/lib/system/audit-labels';

export interface AuditRowData {
  id: string;
  action: string;
  module: string | null;
  entityType: string;
  entityId: string;
  detail: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actorName: string;
}

interface Props {
  rows: AuditRowData[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  modules: string[];
  users: { id: string; fullName: string }[];
  canExport: boolean;
}

function DateFilter({ name, label }: { name: 'from' | 'to'; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      {label}
      <input
        type="date"
        value={params.get(name) ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(name, e.target.value); else next.delete(name);
          next.delete('page');
          router.push(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function RecordCell({ r }: { r: AuditRowData }) {
  const href = recordHref(r.entityType, r.entityId);
  const text = r.detail ?? r.entityId;
  return (
    <span className="break-words">
      <span className="text-xs text-subtle">{entityLabel(r.entityType)}</span>
      <br />
      {href ? (
        // The row opens the drawer when clicked; the link must not.
        <Link href={href} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">{text}</Link>
      ) : (
        <span className="text-ink">{text}</span>
      )}
    </span>
  );
}

/** The saved values before and after a change, side by side, with what changed marked. */
function Comparison({ before, after }: { before: unknown; after: unknown }) {
  const rows = diffValues(before, after);
  if (rows.length === 0) return null;
  const changedCount = rows.filter((r) => r.changed).length;
  return (
    <section aria-label="Before and after">
      <h3 className="text-xs text-subtle">Before and after · {changedCount} changed</h3>
      <div className="mt-1 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[320px] text-left text-xs">
          <thead className="bg-canvas text-subtle">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Field</th>
              <th scope="col" className="px-3 py-2 font-medium">Before</th>
              <th scope="col" className="px-3 py-2 font-medium">After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((d) => (
              <tr key={d.field} className={cn(d.changed && 'bg-warn-bg')}>
                <th scope="row" className="px-3 py-2 align-top font-medium text-ink">
                  {d.field}
                  {d.changed && <span className="ml-1 rounded bg-warn-line px-1 text-[10px] font-semibold text-warn">changed</span>}
                </th>
                <td className="break-words px-3 py-2 align-top text-ink">{d.before}</td>
                <td className={cn('break-words px-3 py-2 align-top text-ink', d.changed && 'font-semibold')}>{d.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AuditLogClient(props: Props) {
  const [open, setOpen] = useState<AuditRowData | null>(null);

  const columns: DataColumn<AuditRowData>[] = [
    { key: 'createdAt', label: 'Date and time', sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: 'actor', label: 'User', sortable: true, render: (r) => r.actorName },
    { key: 'action', label: 'Action', sortable: true, render: (r) => actionLabel(r.action) },
    { key: 'module', label: 'Module', sortable: true, render: (r) => <span className="text-muted">{moduleLabel(r.module)}</span> },
    { key: 'record', label: 'Record', render: (r) => <RecordCell r={r} /> },
    { key: 'ip', label: 'IP', render: (r) => <span className="whitespace-nowrap font-mono text-xs text-muted">{r.ip ?? '—'}</span> },
  ];

  return (
    <>
      <DataTable
        caption="Audit log"
        columns={columns}
        rows={props.rows}
        total={props.total}
        page={props.page}
        pageSize={props.pageSize}
        rowKey={(r) => r.id}
        searchPlaceholder="Search by record name, person or record ID"
        filters={[
          { key: 'user', label: 'User', options: props.users.map((u) => ({ value: u.id, label: u.fullName })) },
          { key: 'module', label: 'Module', options: props.modules.map((m) => ({ value: m, label: moduleLabel(m) })) },
          { key: 'action', label: 'Action', options: props.actions.map((a) => ({ value: a, label: actionLabel(a) })) },
        ]}
        toolbar={<><DateFilter name="from" label="From" /><DateFilter name="to" label="To" /></>}
        exportPath={props.canExport ? '/api/system/audit-log' : undefined}
        onRowClick={setOpen}
        emptyTitle="No activity recorded yet"
        emptyDescription="Changes made in Pfuma appear here."
      />

      <Drawer open={open !== null} onClose={() => setOpen(null)} title="Audit entry">
        {open && (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="flex flex-col gap-3">
              {[
                ['Date and time', formatDateTime(open.createdAt)],
                ['User', open.actorName],
                ['Action', `${actionLabel(open.action)} (${open.action})`],
                ['Module', moduleLabel(open.module)],
                ['Record', `${entityLabel(open.entityType)}${open.detail ? ` · ${open.detail}` : ''}`],
                ['Record ID', open.entityId],
                ['IP address', open.ip ?? '—'],
                ['Browser', open.userAgent ?? '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-subtle">{k}</dt>
                  <dd className="break-words text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <Comparison before={open.before ?? undefined} after={open.after ?? undefined} />
          </div>
        )}
      </Drawer>
    </>
  );
}
