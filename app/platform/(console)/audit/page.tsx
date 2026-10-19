import Link from 'next/link';
import { listPlatformAudit } from '@/lib/platform/audit-view';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Platform audit · Pfuma Platform' };
const PAGE_SIZE = 50;

export default async function PlatformAuditPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const raw = Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page;
  const page = Math.max(1, Number(raw) || 1);
  const { total, rows } = await listPlatformAudit(page, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Platform audit" description="Everything done in this console. Entries cannot be edited or deleted." breadcrumbs={[{ label: 'Schools', href: '/platform' }, { label: 'Platform audit' }]} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label="Platform audit">
          <table className="w-full min-w-[640px] text-left text-sm text-ink">
            <thead className="border-b border-line text-xs text-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Date and time</th>
                <th scope="col" className="px-3 py-3 font-medium">Who</th>
                <th scope="col" className="px-3 py-3 font-medium">Action</th>
                <th scope="col" className="px-3 py-3 font-medium">School</th>
                <th scope="col" className="px-3 py-3 font-medium">Detail</th>
                <th scope="col" className="px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2.5">{r.admin.fullName}</td>
                  <td className="px-3 py-2.5">{r.action.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-3 py-2.5">{r.schoolId ? <Link href={`/platform/schools/${r.schoolId}`} className="text-primary hover:underline">{r.schoolName ?? r.schoolId}</Link> : '—'}</td>
                  <td className="break-words px-3 py-2.5 text-muted">{r.detail ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">{r.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          {page > 1 ? <Link className="min-h-[44px] py-3 text-primary hover:underline" href={`/platform/audit?page=${page - 1}`}>← Newer</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link className="min-h-[44px] py-3 text-primary hover:underline" href={`/platform/audit?page=${page + 1}`}>Older →</Link> : <span />}
        </div>
      )}
    </>
  );
}
