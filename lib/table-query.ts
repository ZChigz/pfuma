// Query-string rules shared by every data table: search, sort, page, page size and
// named filters. The page and the API route both parse with this, so the screen,
// the CSV export and the API always agree on what is being asked for.
import { z } from 'zod';

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const EXPORT_LIMIT = 10_000;

export interface TableQuery {
  q: string;
  sort: string | undefined;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  filters: Record<string, string>;
}

/**
 * @param raw        URLSearchParams or a Next.js searchParams object
 * @param sortable   column keys that may be sorted on; anything else is ignored
 * @param filterKeys query keys that are filters, with an optional validator each
 */
export function parseTableQuery(
  raw: URLSearchParams | Record<string, string | string[] | undefined>,
  opts: { sortable: readonly string[]; filterKeys?: Record<string, z.ZodType<string>>; defaultSort?: string; defaultDir?: 'asc' | 'desc'; defaultPageSize?: number },
): TableQuery {
  const get = (k: string): string | undefined => {
    if (raw instanceof URLSearchParams) return raw.get(k) ?? undefined;
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const q = (get('q') ?? '').trim().slice(0, 100);
  const sortRaw = get('sort');
  const sort = sortRaw && opts.sortable.includes(sortRaw) ? sortRaw : opts.defaultSort;
  const dir = (get('dir') ?? opts.defaultDir ?? 'asc') === 'desc' ? 'desc' : 'asc';
  const page = z.coerce.number().int().min(1).max(100_000).catch(1).parse(get('page') ?? 1);
  const wanted = z.coerce.number().int().catch(opts.defaultPageSize ?? 25).parse(get('pageSize') ?? opts.defaultPageSize ?? 25);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(wanted) ? wanted : opts.defaultPageSize ?? 25;

  const filters: Record<string, string> = {};
  for (const [key, validator] of Object.entries(opts.filterKeys ?? {})) {
    const v = get(key);
    if (!v) continue;
    const ok = validator.safeParse(v);
    if (ok.success) filters[key] = ok.data;
  }
  return { q, sort, dir, page, pageSize, filters };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
