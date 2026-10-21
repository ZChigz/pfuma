'use client';

// Small pieces the Finance screens share: showing money (always one currency at a time), status badges, a button that calls an
// API route (optionally asking for a reason first) and refreshes the page, and a modal form helper.
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { api, problem } from '@/components/exams/shared';

export { api, problem, Section, Notice, Th, Td, Tabs, ClosedNotice } from '@/components/exams/shared';
export { CUR_LABEL, METHOD_OPTIONS, Money, MoneyLine, Pager, fieldClass, labelClass, linkButton, methodLabel, primaryLink } from '@/components/finance/format';
import { fieldClass } from '@/components/finance/format';

const STATUS: Record<string, { v: BadgeVariant; label: string }> = {
  PENDING: { v: 'warning', label: 'Waiting' }, VERIFIED: { v: 'success', label: 'Verified' }, REJECTED: { v: 'danger', label: 'Rejected' }, VOIDED: { v: 'neutral', label: 'Voided' },
  APPROVED: { v: 'info', label: 'Approved' }, RECEIVED: { v: 'warning', label: 'Received, to verify' }, ACTIVE: { v: 'success', label: 'In force' }, PENDING_APPROVAL: { v: 'warning', label: 'To approve' }, CANCELLED: { v: 'neutral', label: 'Cancelled' }, COMPLETED: { v: 'success', label: 'Completed' }, DUE: { v: 'neutral', label: 'Due' }, MISSED: { v: 'danger', label: 'Missed' }, READY: { v: 'warning', label: 'Ready to pay' }, SUBMITTED: { v: 'warning', label: 'Submitted' }, CONFIRMED: { v: 'info', label: 'Confirmed' }, SIGNED_OFF: { v: 'success', label: 'Signed off' }, OPEN: { v: 'neutral', label: 'Open' }, MATCHED: { v: 'success', label: 'Matched' }, UNMATCHED: { v: 'warning', label: 'Not matched' }, IGNORED: { v: 'neutral', label: 'Ignored' }, REQUESTED: { v: 'warning', label: 'Asked for' }, PAID: { v: 'success', label: 'Paid out' }, DRAFT: { v: 'neutral', label: 'Draft' },
  DISBURSED: { v: 'success', label: 'Paid' }, CHARGED: { v: 'neutral', label: 'Charged' },
};
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { v: 'neutral' as const, label: status };
  return <Badge variant={s.v} label={s.label} />;
}

interface RowActionProps {
  label: string;
  url: string;
  method?: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
  /** Ask for a written reason before doing it (voids, rejections ...). */
  reason?: { label: string; min?: number; field?: string };
  /** Ask the person to confirm in words. */
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  done?: string;
  title?: string;
  /** Extra fields shown in the dialog (method, reference ...). */
  fields?: { name: string; label: string; options?: { value: string; label: string }[]; optional?: boolean }[];
  onDone?: () => void;
  /** Go to this page afterwards (a deleted draft has no page of its own any more). */
  redirectTo?: string;
}

/** One button that calls an API route, with a dialog when the action needs a reason, a confirmation or a few details. */
export function RowAction({ label, url, method = 'POST', body = {}, reason, confirm, variant = 'secondary', done, title, fields, onDone, redirectTo }: RowActionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});

  async function run() {
    setBusy(true);
    const payload: Record<string, unknown> = { ...body, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== '')) };
    if (reason) payload[reason.field ?? 'reason'] = text.trim();
    const r = await api(url, method, method === 'DELETE' ? undefined : payload);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(done ?? `${label}: done`);
    setOpen(false);
    setText('');
    onDone?.();
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  const needsDialog = !!(reason || confirm || fields?.length);
  const min = reason?.min ?? 5;
  const blocked = (!!reason && text.trim().length < min) || (fields ?? []).some((f) => !f.optional && !extra[f.name]);
  return (
    <>
      <Button size="sm" variant={variant} loading={!needsDialog && busy} onClick={() => (needsDialog ? setOpen(true) : void run())}>{label}</Button>
      {needsDialog && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={title ?? label}
          size="sm"
          footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant={variant === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={blocked} onClick={() => void run()}>{label}</Button></>}
        >
          <div className="flex flex-col gap-3">
            {confirm && <p className="text-sm text-ink">{confirm}</p>}
            {fields?.map((f) => (
              <div key={f.name} className="flex flex-col gap-1.5">
                <label htmlFor={`ra-${f.name}`} className="text-sm font-medium text-ink">{f.label}</label>
                {f.options ? (
                  <select id={`ra-${f.name}`} className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={extra[f.name] ?? ''} onChange={(e) => setExtra({ ...extra, [f.name]: e.target.value })}>
                    <option value="">Choose…</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={`ra-${f.name}`} className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={extra[f.name] ?? ''} onChange={(e) => setExtra({ ...extra, [f.name]: e.target.value })} />
                )}
              </div>
            ))}
            {reason && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ra-reason" className="text-sm font-medium text-ink">{reason.label}</label>
                <textarea id="ra-reason" className="min-h-[88px] w-full rounded-xl border border-line bg-white p-3 text-sm" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
                <p className="text-xs text-muted">At least {min} characters. It is kept in the audit log.</p>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/** A labelled field row for the modal forms. */
export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Prints the page (statements, receipts, reports). */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return <Button variant="secondary" onClick={() => window.print()} className="print:hidden">{label}</Button>;
}
