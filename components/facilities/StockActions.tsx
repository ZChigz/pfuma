'use client';

// The four things a storekeeper does standing at the shelf: issue stock, sell to a learner, move it to another store, ask for a
// write-off. Each is a short form in a dialog with big touch targets, and the item can be picked by scanning its barcode.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, api, fieldClass, problem } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

export interface StoreOpt { id: string; name: string }
export interface ItemOpt { id: string; name: string; size: string | null; unit: string; qty: number; priceCents: number | null; priceCurrency: string | null }

type Mode = 'issue' | 'sell' | 'transfer' | 'writeoff';
const TITLE: Record<Mode, string> = { issue: 'Issue stock', sell: 'Sell to a learner', transfer: 'Move to another store', writeoff: 'Ask to write off' };

const itemLabel = (i: ItemOpt) => `${i.name}${i.size ? ` (${i.size})` : ''} · ${i.qty} ${i.unit.toLowerCase()} on hand`;
const money = (cents: number, cur: string | null) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(cents / 100).toFixed(2)}`;

function ItemSelect({ id, items, value, onChange }: { id: string; items: ItemOpt[]; value: string; onChange: (id: string) => void }) {
  async function scanned(code: string): Promise<boolean> {
    const r = await api(`/api/facilities/inventory/scan?code=${encodeURIComponent(code)}`, 'GET');
    if (!r.ok) { toast.error(problem(r)); return false; }
    onChange((r.body.data as { id: string }).id);
    return true;
  }
  return (
    <div className="flex gap-2">
      <select id={id} className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an item…</option>
        {items.map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}
      </select>
      <ScanButton label="Scan" title="Scan the item" prompt="the barcode on the item" onScan={scanned} />
    </div>
  );
}

export function StockActions({ stores, items, storeId, can }: { stores: StoreOpt[]; items: ItemOpt[]; storeId: string; can: { issue: boolean; writeoff: boolean } }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState(storeId);
  const [toStore, setToStore] = useState('');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('1');
  const [receiver, setReceiver] = useState('');
  const [department, setDepartment] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [learner, setLearner] = useState<Learner | null>(null);
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: '', qty: '1' }]);
  const [payNow, setPayNow] = useState(false);
  const [kind, setKind] = useState('DAMAGED');
  const [reason, setReason] = useState('');

  function open(m: Mode) {
    setMode(m); setStore(storeId); setToStore(''); setItem(''); setQty('1'); setReceiver(''); setDepartment(''); setConfirmed(false);
    setLearner(null); setLines([{ itemId: '', qty: '1' }]); setPayNow(false); setKind('DAMAGED'); setReason('');
  }

  const priced = items.filter((i) => i.priceCents != null);
  const total = lines.reduce((s, l) => { const it = items.find((i) => i.id === l.itemId); return s + (it?.priceCents ?? 0) * (Number(l.qty) || 0); }, 0);
  const cur = items.find((i) => i.id === lines[0]?.itemId)?.priceCurrency ?? null;

  const ready = !!store && (
    mode === 'issue' ? !!item && Number(qty) > 0 && receiver.trim().length >= 2 && confirmed
    : mode === 'transfer' ? !!item && !!toStore && toStore !== store && Number(qty) > 0
    : mode === 'writeoff' ? !!item && Number(qty) > 0 && reason.trim().length >= 3
    : !!learner && lines.every((l) => l.itemId && Number(l.qty) >= 1));

  async function submit() {
    setBusy(true);
    const body = mode === 'issue' ? { storeId: store, itemId: item, qty: Number(qty), receiverName: receiver.trim(), department: department.trim() || undefined }
      : mode === 'transfer' ? { fromStoreId: store, toStoreId: toStore, itemId: item, qty: Number(qty) }
      : mode === 'writeoff' ? { storeId: store, itemId: item, qty: Number(qty), writeoffReason: kind, reason: reason.trim() }
      : { storeId: store, studentId: learner?.id, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })), payment: payNow ? 'NOW' : 'ACCOUNT' };
    const r = await api(`/api/facilities/inventory/${mode === 'writeoff' ? 'writeoffs' : mode}`, 'POST', body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    if (mode === 'sell') {
      const d = r.body.data as { paid: boolean; paymentError: string | null; totalCents: number; currency: string };
      if (d.paymentError) toast.error(`Charged to the account, but: ${d.paymentError}`);
      else toast.success(d.paid ? `Sold and paid: ${money(d.totalCents, d.currency)}` : `Sold, charged to the learner's account: ${money(d.totalCents, d.currency)}`);
    } else toast.success(mode === 'writeoff' ? 'Sent to the Head for approval' : mode === 'issue' ? 'Issued' : 'Moved');
    setMode(null);
    router.refresh();
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        {can.issue && <Button className="min-h-[52px]" onClick={() => open('issue')}>Issue</Button>}
        {can.issue && <Button className="min-h-[52px]" variant="secondary" onClick={() => open('sell')}>Sell to learner</Button>}
        {can.issue && <Button className="min-h-[52px]" variant="secondary" onClick={() => open('transfer')}>Move</Button>}
        {can.issue && <Button className="min-h-[52px]" variant="ghost" onClick={() => open('writeoff')}>Write off</Button>}
      </div>
      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode ? TITLE[mode] : ''} size="sm"
        footer={<><Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button><Button loading={busy} disabled={!ready} onClick={() => void submit()}>{mode === 'writeoff' ? 'Send for approval' : mode === 'sell' ? (payNow ? 'Sell and take payment' : 'Sell on account') : 'Save'}</Button></>}>
        {mode && (
          <div className="flex flex-col gap-3">
            <Field id="sa-store" label={mode === 'transfer' ? 'From store' : 'Store'}>
              <select id="sa-store" className={fieldClass} value={store} onChange={(e) => setStore(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            {mode === 'transfer' && (
              <Field id="sa-to" label="To store">
                <select id="sa-to" className={fieldClass} value={toStore} onChange={(e) => setToStore(e.target.value)}>
                  <option value="">Choose…</option>
                  {stores.filter((s) => s.id !== store).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            {mode !== 'sell' && (
              <>
                <Field id="sa-item" label="Item"><ItemSelect id="sa-item" items={items} value={item} onChange={setItem} /></Field>
                <Field id="sa-qty" label="Quantity"><input id="sa-qty" className={fieldClass} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
              </>
            )}
            {mode === 'issue' && (
              <>
                <Field id="sa-recv" label="Received by" hint="A department, a member of staff or the kitchen: the name of the person who takes it."><input id="sa-recv" className={fieldClass} value={receiver} onChange={(e) => setReceiver(e.target.value)} /></Field>
                <Field id="sa-dept" label="Department (optional)"><input id="sa-dept" className={fieldClass} value={department} onChange={(e) => setDepartment(e.target.value)} /></Field>
                <label className="flex min-h-[48px] items-center gap-3 text-sm text-ink"><input type="checkbox" className="h-6 w-6 accent-primary" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{receiver.trim() || 'The receiver'} confirms they have received these goods</label>
              </>
            )}
            {mode === 'writeoff' && (
              <>
                <Field id="sa-kind" label="What happened">
                  <select id="sa-kind" className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="EXPIRED">Expired</option><option value="DAMAGED">Damaged</option><option value="STOLEN">Stolen</option><option value="OTHER">Other</option>
                  </select>
                </Field>
                <Field id="sa-why" label="Reason" hint="The Head reads this before approving. Nothing leaves the store until then."><textarea id="sa-why" className="min-h-[88px] w-full rounded-xl border border-line bg-white p-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
              </>
            )}
            {mode === 'sell' && (
              <>
                <Field id="sa-learner" label="Learner"><LearnerPicker id="sa-learner" value={learner} onChange={setLearner} /></Field>
                {lines.map((l, n) => (
                  <div key={n} className="flex flex-col gap-2 rounded-xl border border-line p-2">
                    <ItemSelect id={`sa-line-${n}`} items={priced} value={l.itemId} onChange={(v) => setLines(lines.map((x, k) => (k === n ? { ...x, itemId: v } : x)))} />
                    <div className="flex items-center gap-2">
                      <input aria-label="Quantity" className={fieldClass} inputMode="numeric" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, qty: e.target.value } : x)))} />
                      {lines.length > 1 && <button type="button" className="min-h-[44px] px-2 text-sm text-danger underline" onClick={() => setLines(lines.filter((_, k) => k !== n))}>Remove</button>}
                    </div>
                  </div>
                ))}
                <button type="button" className="min-h-[44px] self-start text-sm font-semibold text-primary" onClick={() => setLines([...lines, { itemId: '', qty: '1' }])}>+ Add another item</button>
                <p className="text-base font-semibold text-ink">Total {money(total, cur)}</p>
                <label className="flex min-h-[48px] items-center gap-3 text-sm text-ink"><input type="checkbox" className="h-6 w-6 accent-primary" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />Paid now in cash (otherwise charged to the learner&apos;s account)</label>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
