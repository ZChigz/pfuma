'use client';

// The count sheet, on the phone: one big number box per item. Counting saves as you go; the system shows the difference and its value.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Notice, api, fieldClass, problem } from '@/components/finance/shared';

export interface CountLine { itemId: string; name: string; size: string | null; unit: string; expectedQty: number; countedQty: number | null; difference: number | null; valueCents: number | null }

export function CountSheet({ id, lines, open }: { id: string; lines: CountLine[]; open: boolean }) {
  const router = useRouter();
  const [counted, setCounted] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.itemId, l.countedQty == null ? '' : String(l.countedQty)])));
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);

  const entered = Object.entries(counted).filter(([, v]) => v.trim() !== '').map(([itemId, v]) => ({ itemId, countedQty: Number(v) }));
  const bad = entered.some((e) => !Number.isFinite(e.countedQty) || e.countedQty < 0);

  async function save(): Promise<boolean> {
    setBusy('save');
    const r = await api(`/api/facilities/inventory/counts/${id}/lines`, 'POST', { lines: entered });
    setBusy(null);
    if (!r.ok) { toast.error(problem(r)); return false; }
    return true;
  }

  async function submit() {
    if (!(await save())) return;
    setBusy('submit');
    const r = await api(`/api/facilities/inventory/counts/${id}/submit`, 'POST', {});
    setBusy(null);
    if (!r.ok) return toast.error(problem(r));
    const d = r.body.data as { status: string; posted: number };
    toast.success(d.status === 'CLOSED' ? `Posted ${d.posted} differences` : 'Sent to the Head: the differences are above the school\'s limit');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {!open && <Notice tone="info">This count has been submitted. It can no longer be changed.</Notice>}
      <ul className="flex flex-col gap-2">
        {lines.map((l) => {
          const v = counted[l.itemId] ?? '';
          const diff = v.trim() === '' || !Number.isFinite(Number(v)) ? null : Math.round((Number(v) - l.expectedQty) * 1000) / 1000;
          return (
            <li key={l.itemId} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{l.name}{l.size ? ` (${l.size})` : ''}</p>
                <p className="text-xs text-muted">System: {l.expectedQty} {l.unit.toLowerCase()}{diff != null && diff !== 0 && <span className={diff < 0 ? ' font-semibold text-danger' : ' font-semibold text-primary'}> · {diff > 0 ? '+' : ''}{diff}</span>}</p>
              </div>
              <input aria-label={`Counted ${l.name}`} className={`${fieldClass} !h-12 !w-28 text-right text-base`} inputMode="decimal" disabled={!open} value={v} onChange={(e) => setCounted({ ...counted, [l.itemId]: e.target.value })} />
            </li>
          );
        })}
      </ul>
      {open && (
        <div className="sticky bottom-0 flex gap-2 bg-canvas py-2">
          <Button className="min-h-[52px] flex-1" variant="secondary" loading={busy === 'save'} disabled={bad || entered.length === 0} onClick={async () => { if (await save()) toast.success('Saved'); }}>Save</Button>
          <Button className="min-h-[52px] flex-1" loading={busy === 'submit'} disabled={bad || entered.length === 0} onClick={() => void submit()}>Submit count</Button>
        </div>
      )}
    </div>
  );
}
