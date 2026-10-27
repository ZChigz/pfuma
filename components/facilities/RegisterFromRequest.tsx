'use client';

// Registers what a paid purchase request bought. The cost, supplier, date and the request itself come from the disbursement; the person only
// says how many, where they are and who looks after them.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { Field, Section, api, fieldClass, problem } from '@/components/finance/shared';

interface Line { id: string; description: string; quantity: number; unitCents: number; registered: number; remaining: number }
interface Req { id: string; requestNumber: string; title: string; currency: string; lines: Line[] }

const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;

export function RegisterFromRequest({ requests, categories, people }: { requests: Req[]; categories: { id: string; name: string }[]; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const [lineId, setLineId] = useState('');
  const [count, setCount] = useState('1');
  const [categoryId, setCategoryId] = useState('');
  const [location, setLocation] = useState('');
  const [custodianId, setCustodianId] = useState('');
  const [busy, setBusy] = useState(false);
  const line = requests.flatMap((r) => r.lines.map((l) => ({ ...l, req: r }))).find((l) => l.id === lineId);

  async function submit() {
    setBusy(true);
    const r = await api('/api/facilities/assets/from-request', 'POST', { requestItemId: lineId, count: Number(count), categoryId, location: location.trim(), ...(custodianId ? { custodianId } : {}) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const tags = (r.body.data as { tags: string[] }).tags;
    toast.success(`Registered ${tags.length}: ${tags[0]}${tags.length > 1 ? ` to ${tags[tags.length - 1]}` : ''}`);
    setLineId(''); setCount('1');
    router.refresh();
  }

  if (requests.length === 0) return <p className="text-sm text-muted">No paid purchase request has items waiting to be registered.</p>;
  return (
    <Section title="Register from a paid purchase request" hint="The cost is the request's, so it is never typed again.">
      <div className="flex flex-col gap-3">
        <Field id="rfr-line" label="Which item">
          <select id="rfr-line" className={fieldClass} value={lineId} onChange={(e) => { setLineId(e.target.value); const l = requests.flatMap((r) => r.lines).find((x) => x.id === e.target.value); setCount(String(Math.min(1, l?.remaining ?? 1))); }}>
            <option value="">Choose…</option>
            {requests.map((r) => <optgroup key={r.id} label={`${r.requestNumber} · ${r.title}`}>{r.lines.filter((l) => l.remaining > 0).map((l) => <option key={l.id} value={l.id}>{l.description} · {money(l.unitCents, r.currency)} each · {l.remaining} left</option>)}</optgroup>)}
          </select>
        </Field>
        {line && (
          <>
            <Field id="rfr-count" label={`How many (up to ${line.remaining})`}><input id="rfr-count" className={fieldClass} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></Field>
            <Field id="rfr-cat" label="Category"><select id="rfr-cat" className={fieldClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field id="rfr-loc" label="Where they are"><input id="rfr-loc" className={fieldClass} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            <Field id="rfr-cust" label="Who looks after them (optional)"><select id="rfr-cust" className={fieldClass} value={custodianId} onChange={(e) => setCustodianId(e.target.value)}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Button className="min-h-[52px]" loading={busy} disabled={!categoryId || !location.trim() || !(Number(count) >= 1)} onClick={() => void submit()}>Register {count || ''} asset{count === '1' ? '' : 's'}</Button>
          </>
        )}
      </div>
    </Section>
  );
}
