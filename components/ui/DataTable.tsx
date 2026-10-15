'use client';

// Data table with search, filters, sort, pagination and CSV export. All state lives
// in the URL (?q=&sort=&dir=&page=&pageSize=&<filter>=), so the server page fetches
// only the rows on screen, links can be shared, and the CSV export uses exactly the
// same query. On a phone each row becomes a card.
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PAGE_SIZES, pageCount } from '@/lib/table-query';
import { EmptyState } from '@/components/ui/EmptyState';

export interface DataColumn<T> {
  key: string;
  label: string;
  /** Sortable columns must also be accepted by the server (parseTableQuery `sortable`). */
  sortable?: boolean;
  render?: (row: T) => ReactNode;
  className?: string;
}

export interface TableFilter {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  filters?: TableFilter[];
  /** URL of the CSV export, without the query; the current query is added. Omit to hide the button. */
  exportPath?: string;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Extra controls on the toolbar, e.g. date pickers. */
  toolbar?: ReactNode;
  caption: string;
}

export function DataTable<T>({
  columns, rows, total, page, pageSize, rowKey, searchPlaceholder = 'Search', filters = [], exportPath,
  emptyTitle, emptyDescription, emptyAction, onRowClick, toolbar, caption,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc';

  function go(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('page');
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Search waits for a pause in typing so slow connections are not flooded.
  useEffect(() => () => clearTimeout(timer.current), []);
  function onSearch(v: string) {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || null }), 350);
  }

  function onSort(key: string) {
    if (sort === key) go({ sort: key, dir: dir === 'asc' ? 'desc' : 'asc' }, false);
    else go({ sort: key, dir: 'asc' }, false);
  }

  const pages = pageCount(total, pageSize);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const exportQuery = new URLSearchParams(params.toString());
  exportQuery.delete('page');
  exportQuery.delete('pageSize');
  exportQuery.set('format', 'csv');

  const hasQuery = !!params.get('q') || filters.some((f) => params.get(f.key));
  const cell = (c: DataColumn<T>, r: T) => (c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—'));

  return (
    <section aria-label={caption} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>
        {filters.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-muted">
            <span className="sr-only">{f.label}</span>
            <select
              value={params.get(f.key) ?? ''}
              onChange={(e) => go({ [f.key]: e.target.value || null })}
              aria-label={f.label}
              className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {toolbar}
        {exportPath && (
          <a
            href={`${exportPath}?${exportQuery.toString()}`}
            download
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint sm:ml-auto"
          >
            Export CSV
          </a>
        )}
      </div>

      <div className={cn('transition-opacity', pending && 'opacity-60')} aria-busy={pending}>
        {rows.length === 0 ? (
          <EmptyState
            title={hasQuery ? 'Nothing matches' : emptyTitle}
            description={hasQuery ? 'Try a different search or clear the filters.' : emptyDescription}
            action={hasQuery ? (
              <button type="button" onClick={() => { setSearch(''); router.push(pathname); }} className="min-h-[44px] rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">
                Clear search and filters
              </button>
            ) : emptyAction}
          />
        ) : (
          <>
            {/* Phone: one card per row */}
            <ul className="flex flex-col gap-2 md:hidden">
              {rows.map((r) => (
                <li key={rowKey(r)}>
                  <div
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn('rounded-2xl bg-white p-4', onRowClick && 'cursor-pointer active:bg-rowhover')}
                  >
                    <div className="font-semibold text-ink">{cell(columns[0], r)}</div>
                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
                      {columns.slice(1).map((c) => (
                        <div key={c.key} className="contents">
                          <dt className="text-xs text-subtle">{c.label}</dt>
                          <dd className="min-w-0 break-words text-ink">{cell(c, r)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablet and desktop: table */}
            <div className="hidden overflow-x-auto rounded-2xl bg-white md:block">
              <table className="w-full text-left text-sm text-ink">
                <caption className="sr-only">{caption}</caption>
                <thead className="border-b border-line">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className="px-4 py-3.5 text-xs font-medium text-subtle"
                      >
                        {c.sortable ? (
                          <button type="button" onClick={() => onSort(c.key)} className="inline-flex min-h-[32px] items-center gap-1 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                            {c.label}
                            <span aria-hidden="true">{sort === c.key ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
                          </button>
                        ) : c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr
                      key={rowKey(r)}
                      onClick={onRowClick ? () => onRowClick(r) : undefined}
                      className={cn(onRowClick && 'cursor-pointer hover:bg-rowhover')}
                    >
                      {columns.map((c) => <td key={c.key} className={cn('px-4 py-3 align-top', c.className)}>{cell(c, r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {total > 0 && (
        <nav aria-label="Pagination" className="flex flex-col items-center gap-2 text-sm text-muted sm:flex-row sm:justify-between">
          <p>
            Showing {from}–{to} of {total}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              Per page
              <select
                value={pageSize}
                onChange={(e) => go({ pageSize: e.target.value })}
                className="min-h-[44px] rounded-xl border border-line bg-white px-2 text-sm text-ink"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => go({ page: String(page - 1) }, false)}
              className="min-h-[44px] rounded-full border border-line bg-white px-4 font-medium text-ink disabled:opacity-40"
            >
              Previous
            </button>
            <span className="min-w-[4.5rem] text-center text-xs">Page {page} of {pages}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => go({ page: String(page + 1) }, false)}
              className="min-h-[44px] rounded-full border border-line bg-white px-4 font-medium text-ink disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
