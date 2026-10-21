'use client';

// The arrears list with a tick-box on each learner: text a reminder to the chosen fee payers, print reminder letters, or leave the list as it is.
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { StatusBadge, Td, Th, api, problem } from '@/components/finance/shared';
import { formatMoney, type Cur } from '@/lib/finance/money';

export interface ArrearsRowView {
  studentId: string; fullName: string; admissionNumber: string | null; className: string | null; guardian: string | null; phone: string | null;
  owed: Record<Cur, number>; oldestDays: number; lastPayment: { date: string } | null; plan: 'ON_PLAN' | 'PLAN_MISSED' | null;
}

export function ArrearsTable({ rows, canSend }: { rows: ArrearsRowView[]; canSend: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function sms() {
    setBusy(true);
    const r = await api('/api/finance/arrears/sms', 'POST', { studentIds: picked });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { queued: number; skipped: number };
    toast.success(`${d.queued} message${d.queued === 1 ? '' : 's'} queued${d.skipped ? `, ${d.skipped} skipped (no phone or nothing owed)` : ''}.`);
  }

  async function letters() {
    setBusy(true);
    const res = await fetch('/api/finance/arrears/letters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentIds: picked }) });
    setBusy(false);
    if (!res.ok) return toast.error('Could not make the letters');
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank');
  }

  return (
    <div className="flex flex-col gap-3">
      {canSend && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.studentId))}>{picked.length === rows.length ? 'Clear' : 'Choose all'}</Button>
          <Button size="sm" loading={busy} disabled={picked.length === 0} onClick={() => void sms()}>Text a reminder ({picked.length})</Button>
          <Button size="sm" variant="secondary" loading={busy} disabled={picked.length === 0} onClick={() => void letters()}>Reminder letters</Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem]">
          <thead><tr>{canSend && <Th />}<Th>Learner</Th><Th>Fee payer</Th><Th className="text-right">Owes</Th><Th className="text-right">Oldest (days)</Th><Th>Last payment</Th><Th>Plan</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.studentId} className="border-t border-line align-top">
                {canSend && <Td><input type="checkbox" aria-label={`Choose ${r.fullName}`} checked={picked.includes(r.studentId)} onChange={() => toggle(r.studentId)} /></Td>}
                <Td><Link className="underline" href={`/finance/accounts/${r.studentId}`}>{r.fullName}</Link><div className="text-xs text-muted">{r.admissionNumber}{r.className ? ` · ${r.className}` : ''}</div></Td>
                <Td>{r.guardian ?? '—'}<div className="text-xs text-muted">{r.phone}</div></Td>
                <Td className="text-right">{(['USD', 'ZIG'] as Cur[]).filter((c) => r.owed[c] > 0).map((c) => <div key={c} className="tabular-nums">{formatMoney(r.owed[c], c)}</div>)}</Td>
                <Td className="text-right">{r.oldestDays > 0 ? r.oldestDays : '—'}</Td>
                <Td>{r.lastPayment?.date ?? 'None'}</Td>
                <Td>{r.plan === 'ON_PLAN' ? <StatusBadge status="ACTIVE" /> : r.plan === 'PLAN_MISSED' ? <StatusBadge status="MISSED" /> : '—'}</Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><Td className="text-muted">Nobody owes anything for these filters.</Td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
