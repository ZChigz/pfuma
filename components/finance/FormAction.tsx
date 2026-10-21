'use client';

// A button that opens a small form and sends it to an API route (a charge, a credit note, a refund request, a fee line, a direct
// expense ...). Money is typed as dollars and cents and checked again on the server.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { Field, api, fieldClass, problem } from '@/components/finance/shared';
import { StudentSearch } from '@/components/finance/StudentSearch';
import { FileUpload } from '@/components/ui/FileUpload';

export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'money' | 'date' | 'select' | 'textarea' | 'number' | 'student' | 'file';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  initial?: string;
  maxLength?: number;
}

export function FormAction({ label, title, url, method = 'POST', fields, extra = {}, done, variant = 'secondary', size = 'sm', submitLabel, intro, onDone }: {
  label: string;
  title?: string;
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  fields: FormField[];
  /** Fixed values sent with the form. */
  extra?: Record<string, unknown>;
  done?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  submitLabel?: string;
  intro?: string;
  onDone?: (data: unknown) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? '']));
  const [v, setV] = useState<Record<string, string>>(blank);

  const missing = fields.some((f) => f.required && !(v[f.name] ?? '').trim());

  async function submit() {
    setBusy(true);
    const body: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      const raw = (v[f.name] ?? '').trim();
      if (raw === '') continue;
      body[f.name] = f.type === 'number' ? Number(raw) : f.type === 'money' ? raw.replace(/,/g, '') : raw;
    }
    const r = await api(url, method, body);
    setBusy(false);
    if (!r.ok) return toast.error(problem(r));
    toast.success(done ?? 'Saved');
    setOpen(false);
    setV(blank());
    onDone?.(r.body.data);
    router.refresh();
  }

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title ?? label} size="md"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={missing} onClick={() => void submit()}>{submitLabel ?? label}</Button></>}>
        <div className="flex flex-col gap-3">
          {intro && <p className="text-sm text-muted">{intro}</p>}
          {fields.map((f) => (
            <Field key={f.name} id={`fa-${f.name}`} label={f.label} hint={f.hint}>
              {f.type === 'file' ? (
                <div><FileUpload endpoint="proofOfPayment" onUpload={(k) => setV({ ...v, [f.name]: k })} />{v[f.name] && <p className="mt-1 text-xs text-muted">File attached.</p>}</div>
              ) : f.type === 'student' ? (
                <StudentSearch id={`fa-${f.name}`} value={v[f.name] ?? ''} onChange={(id) => setV({ ...v, [f.name]: id })} />
              ) : f.type === 'select' ? (
                <select id={`fa-${f.name}`} className={fieldClass} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                  {!f.required && <option value="">—</option>}
                  {f.required && !(v[f.name] ?? '') && <option value="">Choose…</option>}
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={`fa-${f.name}`} className="min-h-[88px] w-full rounded-xl border border-line bg-white p-3 text-sm" value={v[f.name] ?? ''} maxLength={f.maxLength ?? 300} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
              ) : (
                <input id={`fa-${f.name}`} className={fieldClass} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'money' ? 'decimal' : f.type === 'number' ? 'numeric' : undefined} placeholder={f.placeholder ?? (f.type === 'money' ? '0.00' : undefined)} maxLength={f.maxLength} value={v[f.name] ?? ''} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
      </Modal>
    </>
  );
}
