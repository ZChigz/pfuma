'use client';

// Ask for money to be spent. A draft can be changed by the person who wrote it; once submitted it is fixed. The total is worked out
// from the lines in whole cents, and the server checks it again.
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { FileUpload } from '@/components/ui/FileUpload';
import { Field, Section, api, fieldClass, problem } from '@/components/finance/shared';
import { formatMoney, parseCents, plainAmount, type Cur } from '@/lib/finance/money';

const TYPES = [['PURCHASE_ORDER', 'Purchase order'], ['UTILITY_BILL', 'Utility bill'], ['FUEL', 'Fuel'], ['SALARY_ADVANCE', 'Salary advance'], ['MAINTENANCE', 'Maintenance'], ['OTHER', 'Other']] as const;

export interface RequestInitial {
  id?: string;
  title: string;
  type: string;
  department: string;
  justification: string;
  fundId: string;
  currency: Cur;
  supplierId?: string | null;
  neededBy?: string | null;
  quoteKeys?: string[];
  items: { description: string; quantity: number; unitCents: number }[];
}

export function RequestForm({ funds, currencies, initial, suppliers = [] }: { funds: { id: string; name: string }[]; currencies: Cur[]; suppliers?: { id: string; name: string }[]; initial?: RequestInitial }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: initial?.title ?? '', type: initial?.type ?? 'PURCHASE_ORDER', department: initial?.department ?? '', justification: initial?.justification ?? '',
    fundId: initial?.fundId ?? funds[0]?.id ?? '', currency: (initial?.currency ?? currencies[0] ?? 'USD') as Cur, supplierId: initial?.supplierId ?? '', neededBy: initial?.neededBy ?? '',
  });
  const [items, setItems] = useState(initial?.items.length ? initial.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unit: plainAmount(i.unitCents) })) : [{ description: '', quantity: '1', unit: '' }]);
  const [busy, setBusy] = useState(false);
  const [quoteKeys, setQuoteKeys] = useState<string[]>(initial?.quoteKeys ?? []);

  const parsed = useMemo(() => items.map((i) => {
    try { return { ok: i.description.trim() !== '' && /^\d+$/.test(i.quantity) && Number(i.quantity) >= 1, total: Number(i.quantity) * parseCents(i.unit) }; } catch { return { ok: false, total: 0 }; }
  }), [items]);
  const total = parsed.reduce((s, p) => s + (p.ok ? p.total : 0), 0);
  const valid = f.title.trim().length >= 3 && f.department.trim() && f.justification.trim().length >= 5 && f.fundId && parsed.length > 0 && parsed.every((p) => p.ok);

  async function save(submit: boolean) {
    setBusy(true);
    const body = { ...f, supplierId: f.supplierId || undefined, neededBy: f.neededBy || undefined, quoteKeys, items: items.map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity), unit: i.unit.replace(/,/g, '').trim() })), submit };
    const r = initial?.id ? await api(`/api/finance/requests/${initial.id}`, 'PUT', body) : await api('/api/finance/requests', 'POST', body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(submit ? 'Submitted for approval.' : 'Saved as a draft.');
    const id = initial?.id ?? (r.body.data as { id: string }).id;
    router.push(`/finance/requests/${id}`);
    router.refresh();
  }

  return (
    <Section title={initial?.id ? 'Change the draft' : 'New expense request'} hint="Say what is needed and why. Someone else approves it, and a third person pays it.">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field id="rq-title" label="Title"><input id="rq-title" className={fieldClass} value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
        <Field id="rq-type" label="Kind"><select id="rq-type" className={fieldClass} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field id="rq-dept" label="Department"><input id="rq-dept" className={fieldClass} value={f.department} maxLength={60} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
        <Field id="rq-fund" label="Paid from which fund"><select id="rq-fund" className={fieldClass} value={f.fundId} onChange={(e) => setF({ ...f, fundId: e.target.value })}>{funds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field id="rq-cur" label="Currency"><select id="rq-cur" className={fieldClass} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Cur })}>{currencies.map((c) => <option key={c} value={c}>{c === 'USD' ? 'US dollars' : 'ZiG'}</option>)}</select></Field>
        <Field id="rq-sup" label="Supplier (optional)"><select id="rq-sup" className={fieldClass} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">None</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field id="rq-by" label="Needed by (optional)"><input id="rq-by" type="date" className={fieldClass} value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} /></Field>
        <div className="sm:col-span-2"><span className="text-sm font-medium text-ink">Quotes ({quoteKeys.length} attached)</span><p className="text-xs text-muted">A request above the school’s quote limit needs the required number of quotes before it can be submitted.</p><FileUpload endpoint="proofOfPayment" onUpload={(k) => setQuoteKeys((q) => [...q, k])} />{quoteKeys.length > 0 && <button type="button" className="mt-1 text-sm text-danger" onClick={() => setQuoteKeys([])}>Remove all quotes</button>}</div>
        <div className="sm:col-span-2"><Field id="rq-why" label="Why is it needed"><textarea id="rq-why" className="min-h-[88px] w-full rounded-xl border border-line bg-white p-3 text-sm" value={f.justification} maxLength={500} onChange={(e) => setF({ ...f, justification: e.target.value })} /></Field></div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Lines</span>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_7rem_auto] items-center gap-2">
            <input aria-label="What" placeholder="What is needed" className={fieldClass} value={it.description} maxLength={160} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <input aria-label="Quantity" inputMode="numeric" className={fieldClass} value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
            <input aria-label="Price each" inputMode="decimal" placeholder="0.00" className={fieldClass} value={it.unit} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
            {items.length > 1 ? <button type="button" className="text-sm text-danger" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button> : <span />}
          </div>
        ))}
        <button type="button" className="self-start text-sm font-semibold text-primary" onClick={() => setItems([...items, { description: '', quantity: '1', unit: '' }])}>+ Add a line</button>
        <p className="text-sm font-semibold text-ink">Total: <span className="tabular-nums">{formatMoney(total, f.currency)}</span></p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy} disabled={!valid} onClick={() => void save(false)}>Save as a draft</Button>
        <Button loading={busy} disabled={!valid} onClick={() => void save(true)}>Submit for approval</Button>
      </div>
    </Section>
  );
}
