'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { formatDateTime } from '@/lib/utils';

export interface AuditRowData {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  actorName: string;
}

interface Props {
  rows: AuditRowData[];
  total: number;
  page: number;
  pageSize: number;
  actions: string[];
  entities: string[];
  users: { id: string; fullName: string }[];
  canExport: boolean;
}

const pretty = (a: string) => a.replace(/_/g, ' ').toLowerCase();

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

export function AuditLogClient(props: Props) {
  const [open, setOpen] = useState<AuditRowData | null>(null);

  const columns: DataColumn<AuditRowData>[] = [
    { key: 'createdAt', label: 'When', sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: 'actor', label: 'Who', sortable: true, render: (r) => r.actorName },
    { key: 'action', label: 'Action', sortable: true, render: (r) => <span className="capitalize">{pretty(r.action)}</span> },
    { key: 'entityType', label: 'Record', sortable: true, render: (r) => r.entityType },
    { key: 'detail', label: 'Detail', render: (r) => <span className="break-words text-muted">{r.detail ?? '—'}</span> },
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
        searchPlaceholder="Search detail, person or record ID"
        filters={[
          { key: 'action', label: 'Action', options: props.actions.map((a) => ({ value: a, label: pretty(a) })) },
          { key: 'entity', label: 'Record', options: props.entities.map((e) => ({ value: e, label: e })) },
          { key: 'actor', label: 'Person', options: props.users.map((u) => ({ value: u.id, label: u.fullName })) },
        ]}
        toolbar={<><DateFilter name="from" label="From" /><DateFilter name="to" label="To" /></>}
        exportPath={props.canExport ? '/api/system/audit-log' : undefined}
        onRowClick={setOpen}
        emptyTitle="No activity recorded yet"
        emptyDescription="Changes made in Pfuma appear here."
      />

      <Drawer open={open !== null} onClose={() => setOpen(null)} title="Audit entry">
        {open && (
          <dl className="flex flex-col gap-3 text-sm">
            {[
              ['When', formatDateTime(open.createdAt)],
              ['Who', open.actorName],
              ['Action', pretty(open.action)],
              ['Record', `${open.entityType} · ${open.entityId}`],
              ['Detail', open.detail ?? '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-subtle">{k}</dt>
                <dd className="break-words text-ink">{v}</dd>
              </div>
            ))}
            {(['before', 'after'] as const).map((k) =>
              open[k] != null ? (
                <div key={k}>
                  <dt className="text-xs text-subtle">{k === 'before' ? 'Before' : 'After'}</dt>
                  <dd><pre className="mt-1 max-h-72 overflow-auto rounded-xl bg-canvas p-3 text-xs text-ink">{JSON.stringify(open[k], null, 2)}</pre></dd>
                </div>
              ) : null,
            )}
          </dl>
        )}
      </Drawer>
    </>
  );
}
