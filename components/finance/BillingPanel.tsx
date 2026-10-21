'use client';

// Billing a term: first a preview (who is charged, how much per fund and currency, the discounts and sponsor shares), then a confirmation.
// Running it twice charges nobody twice. The result can be downloaded as a list.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Notice, Td, Th, api, fieldClass, problem } from '@/components/finance/shared';
import { formatMoney, formatTotals, type Cur, type Totals } from '@/lib/finance/money';

interface FundTotals { fundId: string; fundName: string; currency: Cur; charged: number; discounts: number; sponsors: number; net: number }
interface Row { studentId: string; name: string; admissionNumber: string; className: string | null; outcome: string; lines: { name: string; fundName: string; currency: Cur; amountCents: number }[]; awards: { label: string; currency: Cur; amountCents: number; sponsor: boolean }[]; net: Totals }
interface Preview { term: { id: string; name: string }; structure: { version: number }; counts: { charged: number; skippedCharged: number; skippedInactive: number }; totals: FundTotals[]; rows: Row[]; truncated: boolean }

const OUTCOME: Record<string, string> = { CHARGED: 'Will be charged', SKIPPED_CHARGED: 'Already charged', SKIPPED_INACTIVE: 'Not enrolled this term' };

export function BillingPanel({ termId, classes }: { termId: string; classes: { id: string; name: string }[] }) {
  const router = useRouter();
  const [classId, setClassId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const body = { termId, ...(classId ? { classId } : {}) };

  async function look() {
    setBusy(true);
    const r = await api('/api/finance/billing/preview', 'POST', body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    setPreview(r.body.data as Preview);
  }

  async function bill() {
    setBusy(true);
    const r = await api('/api/finance/billing', 'POST', body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { charged: number; charges: number };
    toast.success(`Billed ${d.charged} learner${d.charged === 1 ? '' : 's'} with ${d.charges} charge${d.charges === 1 ? '' : 's'}.`);
    setPreview(null);
    router.refresh();
  }

  function download() {
    if (!preview) return;
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [['Name', 'Admission no.', 'Class', 'Outcome', 'Charges', 'Net US$', 'Net ZiG'].join(',')];
    for (const r of preview.rows) lines.push([q(r.name), q(r.admissionNumber), q(r.className ?? ''), q(OUTCOME[r.outcome] ?? r.outcome), r.lines.length, (r.net.USD / 100).toFixed(2), (r.net.ZIG / 100).toFixed(2)].join(','));
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'billing-preview.csv'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bill-class" className="text-sm font-medium text-ink">Class (optional)</label>
          <select id="bill-class" className={`${fieldClass} min-w-[12rem]`} value={classId} onChange={(e) => { setClassId(e.target.value); setPreview(null); }}>
            <option value="">Every class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Button variant="secondary" loading={busy && !preview} onClick={() => void look()}>Preview</Button>
      </div>
      {preview && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <p className="text-sm text-ink">
            <strong>{preview.counts.charged}</strong> learner{preview.counts.charged === 1 ? '' : 's'} will be charged with fee structure version {preview.structure.version}.
            {preview.counts.skippedCharged > 0 && ` ${preview.counts.skippedCharged} already charged.`}{preview.counts.skippedInactive > 0 && ` ${preview.counts.skippedInactive} not enrolled this term.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem]">
              <thead><tr><Th>Fund</Th><Th>Currency</Th><Th className="text-right">Charged</Th><Th className="text-right">Discounts</Th><Th className="text-right">Sponsors</Th><Th className="text-right">Parents pay</Th></tr></thead>
              <tbody>
                {preview.totals.map((t) => (
                  <tr key={`${t.fundId}${t.currency}`} className="border-t border-line">
                    <Td>{t.fundName}</Td><Td>{t.currency}</Td><Td className="text-right">{formatMoney(t.charged, t.currency)}</Td><Td className="text-right">{formatMoney(t.discounts, t.currency)}</Td><Td className="text-right">{formatMoney(t.sponsors, t.currency)}</Td><Td className="text-right font-semibold">{formatMoney(t.net, t.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="text-sm"><summary className="cursor-pointer font-semibold text-primary">Who is charged what ({preview.rows.length}{preview.truncated ? '+' : ''})</summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="w-full min-w-[34rem]"><thead><tr><Th>Learner</Th><Th>Class</Th><Th>Outcome</Th><Th className="text-right">Parents pay</Th></tr></thead>
                <tbody>{preview.rows.map((r) => <tr key={r.studentId} className="border-t border-line"><Td>{r.name}<div className="text-xs text-muted">{r.admissionNumber}</div></Td><Td>{r.className ?? '—'}</Td><Td>{OUTCOME[r.outcome] ?? r.outcome}</Td><Td className="text-right">{formatTotals(r.net) || '—'}</Td></tr>)}</tbody></table>
            </div>
          </details>
          {preview.counts.charged === 0 ? <Notice tone="info">Nobody is left to charge.</Notice> : (
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void bill()}>Confirm and bill {preview.counts.charged} learner{preview.counts.charged === 1 ? '' : 's'}</Button>
              <Button variant="secondary" onClick={download}>Download this list (CSV)</Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
