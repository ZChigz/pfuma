'use client';

// One line of a fee structure: which fee item, how much, in which currency, and who pays it (forms, day or boarding, classes, subject combinations).
// Leaving every audience box empty means everyone.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, api, fieldClass, problem } from '@/components/finance/shared';
import type { Cur } from '@/lib/finance/money';

interface Opt { id: string; name: string }
export interface LineInitial { id: string; catalogItemId: string | null; amount: string; currency: Cur; levelIds: string[]; boarding: 'DAY' | 'BOARDER' | null; classIds: string[]; combinationIds: string[] }

function Pick({ legend, options, value, onChange }: { legend: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-auto rounded-xl border border-line p-2">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}</label>
        ))}
      </div>
    </fieldset>
  );
}

export function LineForm({ structureId, items, levels, classes, combinations, currencies, initial }: {
  structureId: string; items: Opt[]; levels: Opt[]; classes: Opt[]; combinations: Opt[]; currencies: Cur[]; initial?: LineInitial;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState(initial?.catalogItemId ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [currency, setCurrency] = useState<Cur>(initial?.currency ?? currencies[0] ?? 'USD');
  const [lv, setLv] = useState<string[]>(initial?.levelIds ?? []);
  const [boarding, setBoarding] = useState<string>(initial?.boarding ?? '');
  const [cl, setCl] = useState<string[]>(initial?.classIds ?? []);
  const [cb, setCb] = useState<string[]>(initial?.combinationIds ?? []);
  const valid = item !== '' && /^\d+(\.\d{1,2})?$/.test(amount.replace(/,/g, '').trim()) && Number(amount.replace(/,/g, '')) > 0;

  async function save() {
    setBusy(true);
    const url = initial ? `/api/finance/structures/${structureId}/lines/${initial.id}` : `/api/finance/structures/${structureId}/lines`;
    const r = await api(url, initial ? 'PATCH' : 'POST', { catalogItemId: item, amount: amount.replace(/,/g, '').trim(), currency, levelIds: lv, boarding: boarding || null, classIds: cl, combinationIds: cb });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(initial ? 'Line saved' : 'Line added');
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant={initial ? 'ghost' : 'primary'} onClick={() => setOpen(true)}>{initial ? 'Edit' : 'Add a line'}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={initial ? 'Edit fee line' : 'Add a fee line'} size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!valid} onClick={() => void save()}>Save line</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ln-item" label="Fee item"><select id="ln-item" className={fieldClass} value={item} onChange={(e) => setItem(e.target.value)}><option value="">Choose…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
          <Field id="ln-amt" label="Amount"><input id="ln-amt" className={fieldClass} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field id="ln-cur" label="Currency"><select id="ln-cur" className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value as Cur)}>{currencies.map((c) => <option key={c} value={c}>{c === 'USD' ? 'US dollars' : 'ZiG'}</option>)}</select></Field>
          <div className="sm:col-span-3 flex flex-col gap-3">
            <p className="text-xs text-muted">Who pays this line. Leave every box empty for everyone.</p>
            <Pick legend="Forms" options={levels} value={lv} onChange={setLv} />
            <Field id="ln-board" label="Day or boarding"><select id="ln-board" className={fieldClass} value={boarding} onChange={(e) => setBoarding(e.target.value)}><option value="">Everyone</option><option value="DAY">Day scholars only</option><option value="BOARDER">Boarders only</option></select></Field>
            <Pick legend="Classes" options={classes} value={cl} onChange={setCl} />
            <Pick legend="Subject combinations (A-Level)" options={combinations} value={cb} onChange={setCb} />
          </div>
        </div>
      </Modal>
    </>
  );
}
