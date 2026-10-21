'use client';

// A payment plan: the fee payer agrees to pay a debt in instalments on set dates. The bursar records it; a plan that runs past the end of the
// term needs the Head's approval. Each currency has its own plan.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, api, fieldClass, problem } from '@/components/finance/shared';
import { StudentSearch } from '@/components/finance/StudentSearch';
import type { Cur } from '@/lib/finance/money';

interface Payer { guardianId: string; name: string; children: string[] }

export function PlanForm({ currencies, studentId: fixedStudent }: { currencies: Cur[]; studentId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [studentId, setStudentId] = useState(fixedStudent ?? '');
  const [payers, setPayers] = useState<Payer[]>([]);
  const [guardianId, setGuardianId] = useState('');
  const [currency, setCurrency] = useState<Cur>(currencies[0] ?? 'USD');
  const [rows, setRows] = useState<{ dueDate: string; amount: string }[]>([{ dueDate: '', amount: '' }, { dueDate: '', amount: '' }]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setPayers([]); setGuardianId('');
    if (!studentId) return;
    void (async () => {
      const r = await api(`/api/finance/accounts/${studentId}/payers?all=1`, 'GET');
      if (r.ok) {
        const list = (r.body.data as { payers: Payer[] }).payers;
        setPayers(list);
        if (list.length === 1) setGuardianId(list[0]!.guardianId);
      }
    })();
  }, [studentId]);

  const valid = guardianId !== '' && rows.length >= 2 && rows.every((r) => r.dueDate !== '' && /^\d+(\.\d{1,2})?$/.test(r.amount.replace(/,/g, '').trim()) && Number(r.amount.replace(/,/g, '')) > 0);

  async function save() {
    setBusy(true);
    const r = await api('/api/finance/plans', 'POST', { guardianId, currency, notes: notes || undefined, instalments: rows.map((x) => ({ dueDate: x.dueDate, amount: x.amount.replace(/,/g, '').trim() })) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    const st = (r.body.data as { status: string }).status;
    toast.success(st === 'PENDING_APPROVAL' ? 'Plan recorded. It runs past this term, so the Head must approve it.' : 'Plan recorded');
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>New payment plan</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New payment plan" size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!valid} onClick={() => void save()}>Record the plan</Button></>}>
        <div className="flex flex-col gap-3">
          {!fixedStudent && <Field id="pl-stu" label="Learner"><StudentSearch id="pl-stu" value={studentId} onChange={(id) => setStudentId(id)} /></Field>}
          {payers.length > 1 && (
            <Field id="pl-guard" label="Fee payer"><select id="pl-guard" className={fieldClass} value={guardianId} onChange={(e) => setGuardianId(e.target.value)}><option value="">Choose…</option>{payers.map((p) => <option key={p.guardianId} value={p.guardianId}>{p.name} ({p.children.join(', ')})</option>)}</select></Field>
          )}
          {payers.length === 1 && <p className="text-sm text-ink">Fee payer: <strong>{payers[0]!.name}</strong> ({payers[0]!.children.join(', ')})</p>}
          {studentId && payers.length === 0 && <p className="text-sm text-muted">This learner has no fee payer on record. Add one on the learner’s profile first.</p>}
          <Field id="pl-cur" label="Currency"><select id="pl-cur" className={fieldClass} value={currency} onChange={(e) => setCurrency(e.target.value as Cur)}>{currencies.map((c) => <option key={c} value={c}>{c === 'USD' ? 'US dollars' : 'ZiG'}</option>)}</select></Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Instalments</span>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
                <input aria-label="Due date" type="date" className={fieldClass} value={r.dueDate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                <input aria-label="Amount" className={fieldClass} inputMode="decimal" placeholder="0.00" value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                {rows.length > 2 ? <button type="button" className="text-sm text-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button> : <span />}
              </div>
            ))}
            {rows.length < 24 && <button type="button" className="self-start text-sm font-semibold text-primary" onClick={() => setRows([...rows, { dueDate: '', amount: '' }])}>+ Add an instalment</button>}
          </div>
          <Field id="pl-note" label="Note"><input id="pl-note" className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
        </div>
      </Modal>
    </>
  );
}
