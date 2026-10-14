import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

interface TableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  className?: string;
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded-full bg-[#e3e9e4]" />
        </td>
      ))}
    </tr>
  );
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No records found.',
  onRowClick,
  className,
}: TableProps<T>) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-2xl bg-white',
        className,
      )}
    >
      <table className="w-full text-left text-sm text-[#14301f]">
        <thead className="sticky top-0 border-b border-[#e3e9e4] bg-white">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-4 py-3.5 text-xs font-medium text-[#8a968e]"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e3e9e4] bg-white">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} cols={columns.length} />
            ))
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-sm text-[#6b7a70]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => { if (e.key === 'Enter') onRowClick(row); }
                    : undefined
                }
                className={cn(
                  'transition-colors',
                  onRowClick &&
                    'cursor-pointer hover:bg-[#f4f8f5] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#14613f]/30',
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    {col.render
                      ? col.render(row)
                      : (row[col.key] != null ? String(row[col.key]) : '—')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
