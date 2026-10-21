'use client';

// Upload a bank or EcoCash merchant statement (CSV or Excel). The first time for a bank, say which column is the date, the amount and the reference;
// the choice is remembered for the next statement from that bank.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, api, fieldClass, problem } from '@/components/finance/shared';
import type { Cur } from '@/lib/finance/money';

interface Mapping { hasHeader: boolean; dateCol: number; dateFormat: 'YMD' | 'DMY' | 'MDY'; amountCol?: number; creditCol?: number; debitCol?: number; referenceCol?: number; descriptionCol?: number }

export function BankUpload({ banks, currencies }: { banks: string[]; currencies: Cur[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [bank, setBank] = useState(banks[0] ?? '');
  const [account, setAccount] = useState('');
  const [currency, setCurrency] = useState<Cur>(currencies[0] ?? 'USD');
  const [m, setM] = useState<Mapping>({ hasHeader: true, dateCol: 0, dateFormat: 'DMY', amountCol: 1 });
  const [twoCols, setTwoCols] = useState(false);

  async function look(f: File) {
    setFile(f); setBusy(true);
    const fd = new FormData(); fd.append('file', f);
    const res = await fetch('/api/finance/bank/preview', { method: 'POST', body: fd });
    const body = (await res.json()) as { success: boolean; data?: { rows: string[][] }; message?: string };
    setBusy(false);
    if (!res.ok || !body.success) return toast.error(body.message ?? 'Could not read that file');
    setRows(body.data!.rows);
    if (bank.trim()) {
      const saved = await api(`/api/finance/bank/mapping?bank=${encodeURIComponent(bank.trim())}`, 'GET');
      const mm = saved.ok ? (saved.body.data as Mapping | null) : null;
      if (mm) { setM(mm); setTwoCols(mm.amountCol === undefined); }
    }
  }

  async function send() {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file); fd.append('bank', bank.trim()); fd.append('account', account.trim()); fd.append('currency', currency); fd.append('mapping', JSON.stringify(m));
    const res = await fetch('/api/finance/bank/statements', { method: 'POST', body: fd });
    const body = (await res.json()) as { success: boolean; data?: { id: string; lines: number; matched: number }; message?: string };
    setBusy(false);
    if (!res.ok || !body.success) return toast.error(body.message ?? 'Could not read the statement');
    toast.success(`${body.data!.lines} lines read, ${body.data!.matched} matched to payments.`);
    setOpen(false);
    router.push(`/finance/bank/${body.data!.id}`);
    router.refresh();
  }

  const width = Math.max(0, ...rows.map((r) => r.length));
  const colOpts = (optional: boolean) => (
    <>
      {optional && <option value="">None</option>}
      {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{`Column ${i + 1}${rows[0]?.[i] ? `: ${rows[0][i]!.slice(0, 18)}` : ''}`}</option>)}
    </>
  );
  const pick = (key: keyof Mapping) => (e: React.ChangeEvent<HTMLSelectElement>) => setM({ ...m, [key]: e.target.value === '' ? undefined : Number(e.target.value) });
  const valid = !!file && bank.trim() !== '' && rows.length > 0 && (twoCols ? m.creditCol !== undefined : m.amountCol !== undefined);

  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>Upload a statement</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upload a bank statement" size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!valid} onClick={() => void send()}>Read and match</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="bk-bank" label="Bank or wallet" hint="For example CBZ, Steward or EcoCash merchant"><input id="bk-bank" list="bk-banks" className={fieldClass} value={bank} onChange={(e) => setBank(e.target.value)} maxLength={60} /><datalist id="bk-banks">{banks.map((b) => <option key={b} value={b} />)}</datalist></Field>
          <Field id="bk-acct" label="Account (optional)"><input id="bk-acct" className={fieldClass} value={account} onChange={(e) => setAccount(e.target.value)} maxLength={60} /></Field>
          <Field id="bk-cur" label="Currency of the statement"><select id="bk-cur" className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value as Cur)}>{currencies.map((c) => <option key={c} value={c}>{c === 'USD' ? 'US dollars' : 'ZiG'}</option>)}</select></Field>
          <Field id="bk-file" label="File (CSV or Excel)"><input id="bk-file" type="file" accept=".csv,.xlsx,text/csv" className="text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) void look(f); }} /></Field>
          {rows.length > 0 && (
            <>
              <div className="sm:col-span-2 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-xs"><tbody>{rows.slice(0, 6).map((r, i) => <tr key={i} className={i === 0 && m.hasHeader ? 'bg-tint font-semibold' : 'border-t border-line'}>{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1">{c.slice(0, 28)}</td>)}</tr>)}</tbody></table>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={m.hasHeader} onChange={(e) => setM({ ...m, hasHeader: e.target.checked })} /> The first row is a heading</label>
              <Field id="bk-date" label="Date column"><select id="bk-date" className={fieldClass} value={m.dateCol} onChange={pick('dateCol')}>{colOpts(false)}</select></Field>
              <Field id="bk-fmt" label="Date written as"><select id="bk-fmt" className={fieldClass} value={m.dateFormat} onChange={(e) => setM({ ...m, dateFormat: e.target.value as Mapping['dateFormat'] })}><option value="DMY">Day/Month/Year</option><option value="MDY">Month/Day/Year</option><option value="YMD">Year-Month-Day</option></select></Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={twoCols} onChange={(e) => { setTwoCols(e.target.checked); setM({ ...m, amountCol: e.target.checked ? undefined : 1, creditCol: e.target.checked ? 1 : undefined, debitCol: undefined }); }} /> Money in and money out are in separate columns</label>
              {twoCols ? (
                <>
                  <Field id="bk-cr" label="Money in (credit) column"><select id="bk-cr" className={fieldClass} value={m.creditCol ?? ''} onChange={pick('creditCol')}>{colOpts(true)}</select></Field>
                  <Field id="bk-dr" label="Money out (debit) column"><select id="bk-dr" className={fieldClass} value={m.debitCol ?? ''} onChange={pick('debitCol')}>{colOpts(true)}</select></Field>
                </>
              ) : <Field id="bk-amt" label="Amount column" hint="Money in is positive, money out negative"><select id="bk-amt" className={fieldClass} value={m.amountCol ?? ''} onChange={pick('amountCol')}>{colOpts(true)}</select></Field>}
              <Field id="bk-ref" label="Reference column"><select id="bk-ref" className={fieldClass} value={m.referenceCol ?? ''} onChange={pick('referenceCol')}>{colOpts(true)}</select></Field>
              <Field id="bk-desc" label="Description column"><select id="bk-desc" className={fieldClass} value={m.descriptionCol ?? ''} onChange={pick('descriptionCol')}>{colOpts(true)}</select></Field>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
