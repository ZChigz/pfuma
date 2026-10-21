'use client';

// Record money received. It is saved as waiting: it counts only after someone else verifies it. One handover can be split over
// funds (one receipt per fund). The student is fixed when opened from an account, or searched for.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { FileUpload } from '@/components/ui/FileUpload';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, METHOD_OPTIONS, Notice, api, fieldClass, problem } from '@/components/finance/shared';
import { formatMoney, type Cur } from '@/lib/finance/money';

interface FundOpt { id: string; name: string }
interface ChargeOpt { chargeId: string; description: string; fundId: string; currency: Cur; outstandingCents: number }
interface Found { studentId: string; name: string; admissionNumber: string; className: string | null }

export function RecordPaymentModal({ funds, student, charges, label = 'Record a payment', enabledCurrencies = ['USD', 'ZIG'] }: {
  funds: FundOpt[];
  student?: { id: string; name: string };
  charges?: ChargeOpt[];
  label?: string;
  enabledCurrencies?: Cur[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(student ?? null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [currency, setCurrency] = useState<Cur>(enabledCurrencies[0] ?? 'USD');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [note, setNote] = useState('');
  const [proofKey, setProofKey] = useState('');
  const [lines, setLines] = useState<{ fundId: string; amount: string }[]>([{ fundId: funds[0]?.id ?? '', amount: '' }]);
  const [chargeId, setChargeId] = useState('');
  const [payers, setPayers] = useState<{ guardianId: string; name: string; children: string[] }[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [inZig, setInZig] = useState(false);
  const [zigAmount, setZigAmount] = useState('');
  const [backdateReason, setBackdateReason] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const backdated = receivedOn !== '' && receivedOn < today;

  useEffect(() => {
    setPayers([]); setFamilyId('');
    if (!picked) return;
    void (async () => {
      const r = await api(`/api/finance/accounts/${picked.id}/payers`, 'GET');
      if (r.ok) setPayers((r.body.data as { payers: { guardianId: string; name: string; children: string[] }[] }).payers);
    })();
  }, [picked]);

  useEffect(() => {
    if (picked || q.trim().length < 2) { setFound([]); return; }
    const h = setTimeout(async () => {
      const r = await api(`/api/finance/accounts?q=${encodeURIComponent(q.trim())}&pageSize=8`, 'GET');
      if (r.ok) setFound((r.body.data as { rows: Found[] }).rows);
    }, 250);
    return () => clearTimeout(h);
  }, [q, picked]);

  const single = lines.length === 1;
  const options = (charges ?? []).filter((c) => single && c.currency === currency && (!lines[0]?.fundId || c.fundId === lines[0]?.fundId) && c.outstandingCents > 0);
  const money = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.replace(/,/g, '').trim()) && Number(s.replace(/,/g, '')) > 0;
  const valid = !!picked && (inZig ? money(zigAmount) : lines.every((l) => money(l.amount))) && (method === 'CASH' || reference.trim() !== '') && (!backdated || backdateReason.trim().length >= 5);

  async function save() {
    setBusy(true);
    const r = await api('/api/finance/payments', 'POST', {
      studentId: picked!.id, guardianId: familyId || undefined, currency, method, reference: reference || undefined, paidBy: paidBy || undefined, receivedOn: receivedOn || undefined, note: note || undefined,
      backdateReason: backdated ? backdateReason.trim() : undefined, zigAmount: inZig ? zigAmount.replace(/,/g, '').trim() : undefined,
      proofKey: proofKey || undefined, chargeId: single && chargeId ? chargeId : undefined,
      lines: inZig ? [{ fundId: lines[0]?.fundId || null }] : lines.map((l) => ({ fundId: l.fundId || null, amount: l.amount.replace(/,/g, '').trim() })),
    });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const made = (r.body.data as { payments: { receiptNumber: string | null; ackNumber: string }[] }).payments;
    toast.success(`Recorded ${made.map((p) => p.receiptNumber ?? p.ackNumber).join(', ')}. It counts once someone else verifies it.`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a payment" size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!valid} onClick={() => void save()}>Save as waiting for verification</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {picked ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm"><span className="font-semibold text-ink">{picked.name}</span>{!student && <button type="button" className="text-primary underline" onClick={() => { setPicked(null); setQ(''); }}>Change</button>}</div>
            ) : (
              <Field id="rp-student" label="Student" hint="Type a name or admission number">
                <input id="rp-student" className={fieldClass} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
                {found.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-auto rounded-xl border border-line bg-white">
                    {found.map((s) => <li key={s.studentId}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-tint" onClick={() => setPicked({ id: s.studentId, name: s.name })}>{s.name} <span className="text-muted">· {s.admissionNumber}{s.className ? ` · ${s.className}` : ''}</span></button></li>)}
                  </ul>
                )}
              </Field>
            )}
          </div>
          <Field id="rp-cur" label="Currency"><select id="rp-cur" className={fieldClass} value={currency} onChange={(e) => { setCurrency(e.target.value as Cur); setChargeId(''); }}>{enabledCurrencies.map((c) => <option key={c} value={c}>{c === 'USD' ? 'US dollars' : 'ZiG'}</option>)}</select></Field>
          <Field id="rp-method" label="Paid by"><select id="rp-method" className={fieldClass} value={method} onChange={(e) => setMethod(e.target.value)}>{METHOD_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          {payers.length > 0 && (
            <div className="sm:col-span-2">
              <Field id="rp-family" label="Who is paying" hint="A family payment is shared over the brothers and sisters, oldest charge first.">
                <select id="rp-family" className={fieldClass} value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
                  <option value="">{picked?.name} only</option>
                  {payers.map((p) => <option key={p.guardianId} value={p.guardianId}>{p.name} for the whole family ({p.children.join(', ')})</option>)}
                </select>
              </Field>
            </div>
          )}
          {currency === 'USD' && enabledCurrencies.includes('ZIG') && (
            <div className="sm:col-span-2 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={inZig} onChange={(e) => { setInZig(e.target.checked); setZigAmount(''); }} /> The payer handed over ZiG for this US dollar charge</label>
              {inZig && <Field id="rp-zig" label="ZiG received" hint="The US dollar value is worked out at the exchange rate in force on the date received."><input id="rp-zig" className={fieldClass} inputMode="decimal" placeholder="0.00" value={zigAmount} onChange={(e) => setZigAmount(e.target.value)} /></Field>}
            </div>
          )}
          <div className={`sm:col-span-2 flex flex-col gap-2 ${inZig ? 'hidden' : ''}`}>
            <span className="text-sm font-medium text-ink">Amount and fund</span>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
                <select aria-label="Fund" className={fieldClass} value={l.fundId} onChange={(e) => { setLines(lines.map((x, j) => (j === i ? { ...x, fundId: e.target.value } : x))); setChargeId(''); }}><option value="">Any fund (oldest charge first)</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                <input aria-label="Amount" className={fieldClass} inputMode="decimal" placeholder="0.00" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                {lines.length > 1 ? <button type="button" className="text-sm text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button> : <span />}
              </div>
            ))}
            {lines.length < funds.length && <button type="button" className="self-start text-sm font-semibold text-primary" onClick={() => setLines([...lines, { fundId: funds.find((f) => !lines.some((l) => l.fundId === f.id))?.id ?? '', amount: '' }])}>+ Split into another fund</button>}
            {lines.length > 1 && <p className="text-xs text-muted">One receipt is made for each fund.</p>}
          </div>
          {options.length > 0 && (
            <div className="sm:col-span-2">
              <Field id="rp-charge" label="This payment is for" hint="Leave on “Oldest first” unless the payer named a charge.">
                <select id="rp-charge" className={fieldClass} value={chargeId} onChange={(e) => setChargeId(e.target.value)}>
                  <option value="">Oldest first</option>
                  {options.map((c) => <option key={c.chargeId} value={c.chargeId}>{c.description} (owes {formatMoney(c.outstandingCents, c.currency)})</option>)}
                </select>
              </Field>
            </div>
          )}
          {method !== 'CASH' && <Field id="rp-ref" label="Reference" hint="Receipt number or transfer id"><input id="rp-ref" className={fieldClass} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
          <Field id="rp-by" label="Paid by (name)"><input id="rp-by" className={fieldClass} value={paidBy} onChange={(e) => setPaidBy(e.target.value)} /></Field>
          <Field id="rp-date" label="Date received" hint="Leave empty for today"><input id="rp-date" type="date" className={fieldClass} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></Field>
          {backdated && <Field id="rp-back" label="Why is it dated earlier?" hint="A payment dated before today needs a reason."><input id="rp-back" className={fieldClass} value={backdateReason} onChange={(e) => setBackdateReason(e.target.value)} maxLength={200} /></Field>}
          <Field id="rp-note" label="Note"><input id="rp-note" className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></Field>
          {method !== 'CASH' && (
            <div className="sm:col-span-2"><span className="text-sm font-medium text-ink">Proof of payment (optional)</span><FileUpload endpoint="proofOfPayment" onUpload={(k) => setProofKey(k)} /></div>
          )}
          <div className="sm:col-span-2"><Notice tone="info">You cannot verify a payment you recorded yourself. Another person with the right to verify must do it, and only then does it lower the balance.</Notice></div>
        </div>
      </Modal>
    </>
  );
}
