'use client';

// Goods received. Against an approved purchase request the lines fill in from the request and the storekeeper types what actually came,
// the delivery note number and a photo; anything short or damaged is written down for the bursar. A donation or opening stock has no
// request and says why.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FileUpload } from '@/components/ui/FileUpload';
import { toast } from '@/components/ui/Toast';
import { Field, Notice, Section, api, fieldClass, problem } from '@/components/finance/shared';
import { ScanButton } from '@/components/facilities/Scanner';

export interface ReqLine { id: string; description: string; ordered: number; unitCents: number; received: number; outstanding: number }
export interface Req { id: string; requestNumber: string; title: string; currency: string; lines: ReqLine[] }
export interface RItem { id: string; name: string; size: string | null; unit: string; tracksExpiry: boolean }

interface Row { itemId: string; qty: string; damaged: string; cost: string; expiry: string; note: string }
const blank = (cost = ''): Row => ({ itemId: '', qty: '', damaged: '', cost, expiry: '', note: '' });
const label = (i: RItem) => `${i.name}${i.size ? ` (${i.size})` : ''}`;

export function ReceiveForm({ stores, items, requests }: { stores: { id: string; name: string }[]; items: RItem[]; requests: Req[] }) {
  const router = useRouter();
  const [store, setStore] = useState(stores.find((s) => s.name === 'Main store')?.id ?? stores[0]?.id ?? '');
  const [reqId, setReqId] = useState('');
  const req = requests.find((r) => r.id === reqId) ?? null;
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [free, setFree] = useState<Row[]>([blank()]);
  const [currency, setCurrency] = useState('USD');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);

  const row = (l: ReqLine): Row => rows[l.id] ?? blank((l.unitCents / 100).toFixed(2));
  const setRow = (id: string, patch: Partial<Row>, l: ReqLine) => setRows({ ...rows, [id]: { ...row(l), ...patch } });
  const itemOf = (id: string) => items.find((i) => i.id === id);

  async function scan(code: string, apply: (itemId: string) => void): Promise<boolean> {
    const r = await api(`/api/facilities/inventory/scan?code=${encodeURIComponent(code)}`, 'GET');
    if (!r.ok) { toast.error(problem(r)); return false; }
    apply((r.body.data as { id: string }).id);
    return true;
  }

  async function submit() {
    setBusy(true);
    const toLine = (r: Row, requestItemId?: string) => ({
      itemId: r.itemId, qty: Number(r.qty) || 0, damagedQty: Number(r.damaged) || 0, unitCostCents: Math.round(Number(r.cost || 0) * 100),
      ...(requestItemId ? { requestItemId } : {}), ...(r.expiry ? { expiry: r.expiry } : {}), ...(r.note.trim() ? { shortfallNote: r.note.trim() } : {}),
    });
    const lines = req ? req.lines.map((l) => ({ l, r: row(l) })).filter((x) => x.r.itemId).map((x) => toLine(x.r, x.l.id)) : free.filter((r) => r.itemId).map((r) => toLine(r));
    const r = await api('/api/facilities/inventory/receive', 'POST', {
      storeId: store, lines, ...(req ? { purchaseRequestId: req.id, deliveryNote: note.trim() } : { reason: reason.trim(), currency, ...(note.trim() ? { deliveryNote: note.trim() } : {}) }), ...(photo ? { photoKey: photo } : {}),
    });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const short = (r.body.data as { shortfalls: string[] }).shortfalls.length;
    toast.success(short ? 'Received. The bursar has been told about what was short or damaged.' : 'Received into the store');
    setRows({}); setFree([blank()]); setNote(''); setReason(''); setPhoto('');
    router.refresh();
  }

  const filled = req ? req.lines.some((l) => row(l).itemId && (Number(row(l).qty) > 0 || Number(row(l).damaged) > 0)) : free.some((r) => r.itemId && Number(r.qty) > 0);
  const ok = filled && !!store && (req ? note.trim().length > 0 : reason.trim().length >= 3);

  const lineFields = (r: Row, set: (p: Partial<Row>) => void, idp: string, fixed?: ReqLine) => {
    const it = itemOf(r.itemId);
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
        {fixed && <p className="text-sm font-semibold text-ink">{fixed.description} <span className="font-normal text-muted">· ordered {fixed.ordered}, still to come {fixed.outstanding}</span></p>}
        <div className="flex gap-2">
          <select aria-label="Item" className={fieldClass} value={r.itemId} onChange={(e) => set({ itemId: e.target.value })}>
            <option value="">Which item is this?</option>
            {items.map((i) => <option key={i.id} value={i.id}>{label(i)}</option>)}
          </select>
          <ScanButton label="Scan" title="Scan the item" prompt="the barcode on the item" onScan={(c) => scan(c, (id) => set({ itemId: id }))} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field id={`${idp}-q`} label="Delivered (good)"><input id={`${idp}-q`} className={fieldClass} inputMode="decimal" value={r.qty} onChange={(e) => set({ qty: e.target.value })} /></Field>
          <Field id={`${idp}-c`} label={`Cost each (${req?.currency ?? currency})`}><input id={`${idp}-c`} className={fieldClass} inputMode="decimal" value={r.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>
          {req && <Field id={`${idp}-d`} label="Damaged"><input id={`${idp}-d`} className={fieldClass} inputMode="decimal" value={r.damaged} onChange={(e) => set({ damaged: e.target.value })} /></Field>}
          {it?.tracksExpiry && <Field id={`${idp}-e`} label="Expiry date"><input id={`${idp}-e`} type="date" className={fieldClass} value={r.expiry} onChange={(e) => set({ expiry: e.target.value })} /></Field>}
        </div>
        {req && <Field id={`${idp}-n`} label="If short or damaged, what happened?"><input id={`${idp}-n`} className={fieldClass} value={r.note} onChange={(e) => set({ note: e.target.value })} /></Field>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Where is it going?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="rc-store" label="Store"><select id="rc-store" className={fieldClass} value={store} onChange={(e) => setStore(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field id="rc-req" label="Delivered against">
            <select id="rc-req" className={fieldClass} value={reqId} onChange={(e) => { setReqId(e.target.value); setRows({}); }}>
              <option value="">No purchase request: donation or opening stock</option>
              {requests.map((r) => <option key={r.id} value={r.id}>{r.requestNumber} · {r.title}</option>)}
            </select>
          </Field>
        </div>
      </Section>
      <Section title={req ? `${req.requestNumber}: what actually came` : 'What came'} hint={req ? 'The lines are the request\'s. Type what was delivered.' : undefined}>
        <div className="flex flex-col gap-3">
          {req ? req.lines.filter((l) => l.outstanding > 0).map((l) => <div key={l.id}>{lineFields(row(l), (p) => setRow(l.id, p, l), `rl-${l.id}`, l)}</div>)
            : free.map((r, n) => <div key={n}>{lineFields(r, (p) => setFree(free.map((x, k) => (k === n ? { ...x, ...p } : x))), `fl-${n}`)}</div>)}
          {!req && <button type="button" className="min-h-[44px] self-start text-sm font-semibold text-primary" onClick={() => setFree([...free, blank()])}>+ Add another item</button>}
        </div>
      </Section>
      <Section title="Proof">
        <div className="flex flex-col gap-3">
          {req ? <Field id="rc-dn" label="Delivery note number"><input id="rc-dn" className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field> : (
            <>
              <Field id="rc-reason" label="Why is there no purchase request?" hint="For example: donation from the PTA, or opening stock at the start of the year."><input id="rc-reason" className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <Field id="rc-cur" label="Currency of the costs"><select id="rc-cur" className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="USD">US dollars</option><option value="ZIG">ZiG</option></select></Field>
            </>
          )}
          <FileUpload endpoint="proofOfPayment" label="Photo of the delivery note (optional)" onUpload={setPhoto} />
        </div>
      </Section>
      {req && <Notice tone="info">Short or damaged goods are noted for the bursar. The rest stays open on the request until it arrives.</Notice>}
      <Button className="min-h-[52px]" loading={busy} disabled={!ok} onClick={() => void submit()}>Receive into the store</Button>
    </div>
  );
}
