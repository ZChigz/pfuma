'use client';

// Self-service forms: a leave request that shows the balance before and after, and requests to change your own details.
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, api, fieldClass, problem } from '@/components/finance/shared';

export function LeaveRequestForm({ types, colleagues }: { types: { id: string; name: string }[]; colleagues: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ leaveTypeId: '', startDate: '', endDate: '', startHalfDay: false, endHalfDay: false, reason: '', handoverNotes: '', coverEmployeeId: '', attachmentKey: '' });
  const [preview, setPreview] = useState<{ days?: number; before?: number; after?: number; limited?: boolean; error?: string } | null>(null);
  const ready = v.leaveTypeId && v.startDate && v.endDate && v.endDate >= v.startDate;
  const body = () => ({ ...v, reason: v.reason || undefined, handoverNotes: v.handoverNotes || undefined, coverEmployeeId: v.coverEmployeeId || undefined, attachmentKey: v.attachmentKey || undefined });

  useEffect(() => {
    if (!open || !ready) { setPreview(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await api('/api/hr/leave/preview', 'POST', body());
      if (cancelled) return;
      setPreview(r.ok ? { days: r.body.data.days, before: r.body.data.balanceBefore, after: r.body.data.balanceAfter, limited: r.body.data.limited } : { error: problem(r) });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ready, v.leaveTypeId, v.startDate, v.endDate, v.startHalfDay, v.endHalfDay, v.attachmentKey]);

  async function send() {
    setBusy(true);
    const r = await api('/api/hr/leave/requests', 'POST', body());
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success('Leave requested. The Head will decide.');
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Request leave</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Request leave" size="md" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!ready || !!preview?.error} onClick={() => void send()}>Send request</Button></>}>
        <div className="flex flex-col gap-3">
          <Field id="lr-type" label="Type of leave"><select id="lr-type" className={fieldClass} value={v.leaveTypeId} onChange={(e) => setV({ ...v, leaveTypeId: e.target.value })}><option value="">Choose…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="lr-from" label="From"><input id="lr-from" type="date" className={fieldClass} value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></Field>
            <Field id="lr-to" label="To"><input id="lr-to" type="date" className={fieldClass} value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} /></Field>
          </div>
          <div className="flex gap-4 text-sm text-ink"><label className="flex items-center gap-1"><input type="checkbox" checked={v.startHalfDay} onChange={(e) => setV({ ...v, startHalfDay: e.target.checked })} /> First day is a half day</label><label className="flex items-center gap-1"><input type="checkbox" checked={v.endHalfDay} onChange={(e) => setV({ ...v, endHalfDay: e.target.checked })} /> Last day is a half day</label></div>
          {preview && (preview.error ? <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{preview.error}</p> : (
            <p className="rounded-xl bg-tint px-3 py-2 text-sm text-ink">{preview.days} school day{preview.days === 1 ? '' : 's'}. {preview.limited ? <>Balance: <b>{preview.before}</b> now, <b>{preview.after}</b> after this request.</> : 'This leave is not taken off a balance.'}</p>
          ))}
          <Field id="lr-reason" label="Reason"><textarea id="lr-reason" className="min-h-[72px] w-full rounded-xl border border-line bg-white p-3 text-sm" maxLength={500} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
          <Field id="lr-handover" label="Handover notes"><textarea id="lr-handover" className="min-h-[72px] w-full rounded-xl border border-line bg-white p-3 text-sm" maxLength={1000} value={v.handoverNotes} onChange={(e) => setV({ ...v, handoverNotes: e.target.value })} /></Field>
          <Field id="lr-cover" label="Who covers your duties"><select id="lr-cover" className={fieldClass} value={v.coverEmployeeId} onChange={(e) => setV({ ...v, coverEmployeeId: e.target.value })}><option value="">Nobody in particular</option>{colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="lr-doc" label="Attachment (medical certificate or proof of registration)" hint="Needed for sick leave over 2 days, maternity and study leave."><input id="lr-doc" className={fieldClass} placeholder="Paste the uploaded file key" value={v.attachmentKey} onChange={(e) => setV({ ...v, attachmentKey: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

type Group = 'DETAILS' | 'BANK' | 'NEXT_OF_KIN';
const FIELDS: Record<Group, { name: string; label: string; required?: boolean; select?: [string, string][] }[]> = {
  DETAILS: [{ name: 'homeAddress', label: 'Home address' }, { name: 'personalPhone', label: 'Personal phone' }, { name: 'personalEmail', label: 'Personal email' }, { name: 'maritalStatus', label: 'Marital status' }],
  BANK: [{ name: 'paymentMethod', label: 'Paid by', required: true, select: [['BANK', 'Bank'], ['ECOCASH', 'EcoCash'], ['CASH', 'Cash']] }, { name: 'bankName', label: 'Bank' }, { name: 'bankBranch', label: 'Branch' }, { name: 'accountNumber', label: 'Account number' }, { name: 'ecocashNumber', label: 'EcoCash number' }],
  NEXT_OF_KIN: [{ name: 'name', label: 'Name', required: true }, { name: 'relationship', label: 'Relationship', required: true }, { name: 'phone', label: 'Phone', required: true }, { name: 'address', label: 'Address' }],
};
const TITLE: Record<Group, string> = { DETAILS: 'Change my address, phone or email', BANK: 'Change my bank or EcoCash details', NEXT_OF_KIN: 'Add or change next of kin' };

/** Asks HR to change something on your own record. HR approves; bank details also need the Owner. */
export function ChangeRequestForm({ group }: { group: Group }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const missing = FIELDS[group].some((f) => f.required && !(v[f.name] ?? '').trim()) || FIELDS[group].every((f) => !(v[f.name] ?? '').trim());

  async function send() {
    setBusy(true);
    const changes = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== '').map(([k, x]) => [k, x.trim()]));
    const r = await api('/api/hr/me/changes', 'POST', { group, changes, ...(group === 'NEXT_OF_KIN' ? {} : {}) });
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(group === 'BANK' ? 'Sent. HR and the Owner both approve a bank change.' : 'Sent to HR');
    setOpen(false);
    setV({});
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{TITLE[group]}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={TITLE[group]} size="md" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={missing} onClick={() => void send()}>Send request</Button></>}>
        <div className="flex flex-col gap-3">
          {group === 'BANK' && <p className="text-sm text-muted">Bank detail changes are the most common payroll fraud, so HR and the Owner both approve, and you get an SMS when it changes.</p>}
          {FIELDS[group].map((f) => (
            <Field key={f.name} id={`cr-${f.name}`} label={f.label}>
              {f.select ? <select id={`cr-${f.name}`} className={fieldClass} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}><option value="">Choose…</option>{f.select.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
                : <input id={`cr-${f.name}`} className={fieldClass} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />}
            </Field>
          ))}
        </div>
      </Modal>
    </>
  );
}
