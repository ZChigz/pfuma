'use client';
// The "Active exceptions" report: every temporary grant or deny in force, who gave it, why and until when.
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { send } from '@/components/access/send';
import { Can } from '@/components/access/AccessProvider';
import type { OverrideListRow } from '@/lib/system/access-admin';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const STATE = { ACTIVE: { variant: 'success', label: 'In force' }, EXPIRED: { variant: 'neutral', label: 'Ended' }, REVOKED: { variant: 'neutral', label: 'Taken back' } } as const;

export function ExceptionsClient({ rows, history, canExport }: { rows: OverrideListRow[]; history: boolean; canExport: boolean }) {
  const router = useRouter();
  const [ending, setEnding] = useState<OverrideListRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!ending) return;
    setBusy(true);
    const r = await send(`/api/system/overrides/${ending.id}`, 'DELETE');
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success('Exception ended');
    setEnding(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={history ? '/system/roles?tab=exceptions' : '/system/roles?tab=exceptions&history=1'} className="min-h-[44px] py-2 text-sm font-medium text-primary hover:underline">
          {history ? 'Show only those in force' : 'Include those that have ended'}
        </Link>
        {canExport && (
          <a className="min-h-[44px] py-2 text-sm font-medium text-primary hover:underline" href={`/api/system/exceptions?format=csv${history ? '&history=1' : ''}`}>Download as a spreadsheet</a>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-sm text-muted">There are no exceptions {history ? 'on record' : 'in force'}.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white" tabIndex={0} role="region" aria-label="Exceptions to access">
          <table className="w-full min-w-[720px] text-left text-sm text-ink">
            <thead className="border-b border-line">
              <tr>{['Person', 'What', 'Why', 'Until', 'Given by', ''].map((h) => <th key={h} scope="col" className="px-4 py-3 text-xs font-medium text-subtle">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium"><Link href={`/admin/users/${r.userId}/access`} className="hover:underline">{r.userName}</Link></td>
                  <td className="px-4 py-3">
                    <span className="mr-2"><Badge variant={r.effect === 'GRANT' ? 'info' : 'danger'} label={r.effect === 'GRANT' ? 'Allowed' : 'Refused'} /></span>
                    {r.label}
                  </td>
                  <td className="px-4 py-3 text-muted">{r.reason}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{when(r.expiresAt)} <Badge variant={STATE[r.state].variant} label={STATE[r.state].label} /></td>
                  <td className="px-4 py-3 text-muted">{r.createdBy}</td>
                  <td className="px-4 py-3 text-right">
                    {r.state === 'ACTIVE' && <Can permission="system.users.edit"><Button size="sm" variant="secondary" onClick={() => setEnding(r)}>End now</Button></Can>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog open={!!ending} title="End this exception?" confirmLabel="End now" destructive loading={busy} onConfirm={end} onCancel={() => setEnding(null)}>
        {ending?.userName} will stop having this change straight away. It stays in the history.
      </ConfirmDialog>
    </div>
  );
}
