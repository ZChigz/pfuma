import Link from 'next/link';
import { listSchools, isStatus } from '@/lib/platform/schools';
import { Badge } from '@/components/ui/Badge';
import { STATUS_BADGE } from '@/components/platform/status';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate, cn } from '@/lib/utils';

export const metadata = { title: 'Schools · Pfuma Platform' };

const PAGE_SIZE = 25;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SchoolsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const q = (first(searchParams.q) ?? '').trim().slice(0, 100);
  const status = isStatus(first(searchParams.status)) ? first(searchParams.status) : undefined;
  const page = Math.max(1, Number(first(searchParams.page)) || 1);
  const { total, rows, counts } = await listSchools({ q: q || undefined, status, page, pageSize: PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { q: q || undefined, status, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/platform?${s}` : '/platform';
  };

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every school on Pfuma. Open one to manage its plan, modules and invoices."
        actions={<Link href="/platform/schools/new" className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">New school</Link>}
      />

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        <Link href={href({ status: undefined, page: undefined })} aria-current={!status ? 'page' : undefined} className={cn('inline-flex min-h-[44px] items-center rounded-full px-4 text-sm', !status ? 'bg-primary text-white' : 'bg-white text-muted hover:text-ink')}>
          All
        </Link>
        {Object.entries(STATUS_BADGE).map(([key, s]) => (
          <Link key={key} href={href({ status: key, page: undefined })} aria-current={status === key ? 'page' : undefined} className={cn('inline-flex min-h-[44px] items-center rounded-full px-4 text-sm', status === key ? 'bg-primary text-white' : 'bg-white text-muted hover:text-ink')}>
            {s.label} · {counts[key] ?? 0}
          </Link>
        ))}
      </nav>

      <form action="/platform" method="get" role="search" className="flex gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input type="search" name="q" defaultValue={q} placeholder="Search school or province" aria-label="Search schools" className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        <button type="submit" className="min-h-[44px] rounded-xl border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint">Search</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No schools found" description={q || status ? 'Try another search or filter.' : 'Create the first school to get started.'} cta={q || status ? undefined : { label: 'New school', href: '/platform/schools/new' }} />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label="Schools">
          <table className="w-full min-w-[640px] text-left text-sm text-ink">
            <thead className="border-b border-line text-xs text-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">School</th>
                <th scope="col" className="px-3 py-3 font-medium">Status</th>
                <th scope="col" className="px-3 py-3 font-medium">Plan</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Students</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Users</th>
                <th scope="col" className="px-4 py-3 font-medium">Renews</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-rowhover">
                  <td className="px-4 py-3">
                    <Link href={`/platform/schools/${s.id}`} className="font-medium text-primary hover:underline">{s.name}</Link>
                    <span className="block text-xs text-muted">{s.province ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3"><Badge variant={STATUS_BADGE[s.status].variant} label={STATUS_BADGE[s.status].label} /></td>
                  <td className="px-3 py-3">{s.plan?.name ?? '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{s._count.students}{s.studentLimit ? ` / ${s.studentLimit}` : ''}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{s._count.users}</td>
                  <td className="whitespace-nowrap px-4 py-3">{s.renewalDate ? formatDate(s.renewalDate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          {page > 1 ? <Link className="min-h-[44px] py-3 text-primary hover:underline" href={href({ page: String(page - 1) })}>← Previous</Link> : <span />}
          <span>Page {page} of {pages} · {total} schools</span>
          {page < pages ? <Link className="min-h-[44px] py-3 text-primary hover:underline" href={href({ page: String(page + 1) })}>Next →</Link> : <span />}
        </div>
      )}
    </>
  );
}
