'use client';

// Small pieces the Student Information screens share: calling the API, status badges, a photo or initials, and form layout.
import { useState, type ReactNode } from 'react';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

export interface ApiBody {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ApiResult { ok: boolean; status: number; body: ApiBody }

/** Calls an API route and always answers, never throws: a network failure reads as a message the person can act on. */
export async function api(url: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'GET', payload?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: ApiBody = {};
    try { body = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { message: 'There is no connection. Check your data and try again.' } };
  }
}

/** The first thing wrong, in words: field errors first, then the message. */
export function problem(r: ApiResult, fallback = 'That did not work. Please try again.'): string {
  const first = r.body.errors ? Object.values(r.body.errors).flat()[0] : undefined;
  return first ?? r.body.message ?? fallback;
}

/** Field errors as { field: message } for showing next to inputs. Keys like guardians.0.phone are kept as they are. */
export function fieldMessages(r: ApiResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.body.errors ?? {})) if (v[0]) out[k] = v[0];
  return out;
}

export const STATUS_VARIANT: Record<string, BadgeVariant> = {
  ACTIVE: 'success', SUSPENDED: 'warning', TRANSFERRED: 'neutral', GRADUATED: 'info', WITHDRAWN: 'neutral', EXPELLED: 'danger', DECEASED: 'neutral',
};
export const STATUS_TEXT: Record<string, string> = {
  ACTIVE: 'Active', SUSPENDED: 'Suspended', TRANSFERRED: 'Transferred', GRADUATED: 'Graduated', WITHDRAWN: 'Withdrawn', EXPELLED: 'Expelled', DECEASED: 'Deceased',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'neutral'} label={STATUS_TEXT[status] ?? status} />;
}

export function BoardingBadge({ boarding }: { boarding: 'DAY' | 'BOARDER' }) {
  return <Badge variant={boarding === 'BOARDER' ? 'info' : 'neutral'} label={boarding === 'BOARDER' ? 'Boarder' : 'Day scholar'} />;
}

/** The student's photo, or their initials when there is none. A small image keeps pages light on slow data. */
export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const style = { width: size, height: size, fontSize: Math.max(11, Math.round(size / 2.8)) };
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className="flex-shrink-0 rounded-full object-cover" style={style} />
  ) : (
    <span aria-hidden="true" className="flex flex-shrink-0 items-center justify-center rounded-full bg-tint font-semibold text-primary" style={style}>{initials}</span>
  );
}

export function Section({ title, children, action, className }: { title?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl bg-white p-4 sm:p-6', className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Label and value pairs; empty values are left out so the page shows only what is known. */
export function Facts({ rows }: { rows: [string, ReactNode | null | undefined | false][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '');
  if (shown.length === 0) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
      {shown.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export { formatDay, formatWhen } from '@/lib/students/format';

/** A form row of labelled controls that stacks on a phone. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

export function Checkbox({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex min-h-[44px] cursor-pointer items-start gap-2.5 py-1.5 text-sm text-ink', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 flex-shrink-0 rounded border-line text-primary focus:ring-primary/40" />
      <span>{label}{hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

export function TextArea({ label, value, onChange, error, rows = 3, hint, required, id, maxLength }: { label: string; value: string; onChange: (v: string) => void; error?: string; rows?: number; hint?: string; required?: boolean; id: string; maxLength?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}{required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}</label>
      <textarea id={id} rows={rows} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}
        className={cn('rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20', error && 'border-danger')} />
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** A small hook for "doing something": disables buttons while a request is out. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }
  return { busy, run };
}

/** A line of warnings (age, class full, duplicates) with a tick for "I have seen this". */
export function WarningList({ warnings, accepted, onToggle }: { warnings: { code: string; message: string }[]; accepted: string[]; onToggle: (code: string) => void }) {
  if (warnings.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warn/40 bg-warn-bg p-3 text-sm text-ink">
      <p className="font-semibold text-warn">Please check these before saving</p>
      {warnings.map((w) => (
        <Checkbox key={w.code} checked={accepted.includes(w.code)} onChange={() => onToggle(w.code)} label={w.message} />
      ))}
    </div>
  );
}
