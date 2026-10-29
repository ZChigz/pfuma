'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { useCan } from '@/components/access/AccessProvider';
import { Drawer } from '@/components/ui/Drawer';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { STAFF_ROLES, STAFF_ROLE_LABEL } from '@/lib/staff-roles';
import { buildWhatsAppLink, cn, formatDate, formatDateTime } from '@/lib/utils';
import { SIGN_IN_SETUPS, SystemCreateUserSchema, USER_TITLES } from '@/lib/validations/system';

export type UserStatus = 'invited' | 'active' | 'deactivated';

export interface UserRowData {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  title: string | null;
  roles: string[];
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

const STATUS: Record<UserStatus, { label: string; variant: BadgeVariant }> = {
  invited: { label: 'Invited', variant: 'info' },
  active: { label: 'Active', variant: 'success' },
  deactivated: { label: 'Deactivated', variant: 'danger' },
};

type FormInput = z.input<typeof SystemCreateUserSchema>;
type FormOutput = z.output<typeof SystemCreateUserSchema>;

interface Props {
  rows: UserRowData[];
  total: number;
  page: number;
  pageSize: number;
  counts: { active: number; invited: number; deactivated: number };
  currentUserId: string;
  schoolName: string;
  // All from can() on the server.
  canCreate: boolean;
  canUpdate: boolean;
  canDeactivate: boolean;
  canResetPassword: boolean;
  /** Make a one-time temporary password instead of a reset link. */
  canTempPassword?: boolean;
  /** End every open session of one user. */
  canSignOut?: boolean;
  canExport: boolean;
  canInvite: boolean;
  canImport: boolean;
  canViewActivity: boolean;
}

interface Invite { url: string; expiresAt: string; reset?: boolean }
type Shown =
  | { kind: 'invite'; title: string; user: { fullName: string; email: string; phone: string | null }; invite: Invite }
  | { kind: 'password'; title: string; user: { fullName: string; email: string }; password: string }
  | null;

type Pending = { kind: 'deactivate' | 'reactivate' | 'reset' | 'temp' | 'signout'; user: UserRowData } | null;

interface ImportResult {
  created: number;
  rejected: { row: number; name: string; email: string; phone: string; roles: string; reason: string }[];
  invites: { fullName: string; email: string; phone: string; url: string }[];
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v);
function download(name: string, rows: string[][]) {
  const blob = new Blob([`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.info('Copied'), () => toast.error('Could not copy'));
const firstError = (body: { errors?: Record<string, string[]>; message?: string }, fallback: string) =>
  body.errors ? Object.values(body.errors).flat()[0] : body.message ?? fallback;

export function UsersClient(props: Props) {
  const router = useRouter();
  const mayManageAccess = useCan('system.roles.view');
  const params = useSearchParams();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'edit'; user: UserRowData } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown>(null);
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(SystemCreateUserSchema),
    defaultValues: { fullName: '', email: '', phone: '', roles: [], title: '', signIn: 'INVITE' },
  });
  const roles = watch('roles') ?? [];
  const signIn = watch('signIn');
  const editing = drawer?.mode === 'edit' ? drawer.user : null;

  function openDrawer(next: NonNullable<typeof drawer>) {
    reset(
      next.mode === 'edit'
        ? { fullName: next.user.fullName, email: next.user.email, phone: next.user.phone ?? '', roles: next.user.roles as FormInput['roles'], title: (next.user.title ?? '') as FormInput['title'], signIn: 'INVITE' }
        : { fullName: '', email: '', phone: '', roles: [], title: '', signIn: 'INVITE' },
    );
    setDrawer(next);
  }

  // The dashboard's "Add user" quick action links here with ?new=1.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (wantsNew && props.canCreate) openDrawer({ mode: 'create' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRole = (key: string) =>
    setValue('roles', (roles.includes(key as never) ? roles.filter((r) => r !== key) : [...roles, key]) as FormInput['roles'], { shouldValidate: true, shouldDirty: true });

  async function save(values: FormOutput) {
    const res = await fetch(editing ? `/api/system/users/${editing.id}` : '/api/system/users', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing ? { fullName: values.fullName, email: values.email, phone: values.phone, roles: values.roles, title: values.title } : values),
    });
    const body = await res.json();
    if (!res.ok) {
      toast.error(firstError(body, 'Could not save the user'));
      return;
    }
    setDrawer(null);
    if (editing) toast.success('User updated');
    else if (body.data.invite) setShown({ kind: 'invite', title: 'Invite ready', user: body.data.user, invite: body.data.invite });
    else setShown({ kind: 'password', title: 'User added', user: body.data.user, password: body.data.tempPassword });
    router.refresh();
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const url =
        pending.kind === 'temp' ? `/api/admin/users/${pending.user.id}/reset-password`
        : pending.kind === 'signout' ? `/api/admin/users/${pending.user.id}/logout`
        : `/api/system/users/${pending.user.id}/${pending.kind === 'reset' ? 'reset-password' : pending.kind}`;
      const res = await fetch(url, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? 'That did not work'); return; }
      if (pending.kind === 'temp') setShown({ kind: 'password', title: 'Temporary password', user: pending.user, password: body.data.tempPassword });
      else if (pending.kind === 'signout') toast.success(`${pending.user.fullName} signed out everywhere`);
      else if (pending.kind === 'reset') setShown({ kind: 'invite', title: 'Reset link ready', user: pending.user, invite: { ...body.data.reset, reset: true } });
      else toast.success(pending.kind === 'deactivate' ? 'User deactivated' : 'User reactivated');
      setPending(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function newInvite(u: UserRowData) {
    setBusy(true);
    try {
      const res = await fetch(`/api/system/users/${u.id}/invite`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? 'Could not make a new invite'); return; }
      setShown({ kind: 'invite', title: 'New invite ready', user: u, invite: body.data.invite });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runImport(file: File) {
    setImportBusy(true);
    setImportResult(null);
    try {
      if (file.size > 300_000) { toast.error('The file is too big (at most 300 KB)'); return; }
      const res = await fetch('/api/system/users/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: await file.text() }) });
      const body = await res.json();
      if (!res.ok) { toast.error(firstError(body, 'Could not read the file')); return; }
      setImportResult(body.data);
      if (body.data.created > 0) router.refresh();
    } finally {
      setImportBusy(false);
    }
  }

  const action = 'min-h-[44px] rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

  const columns: DataColumn<UserRowData>[] = [
    { key: 'fullName', label: 'Name', sortable: true, render: (u) => <span className="font-medium">{u.title ? `${u.title} ` : ''}{u.fullName}{u.id === props.currentUserId && <span className="ml-1.5 text-xs text-muted">(you)</span>}</span> },
    { key: 'email', label: 'Email', sortable: true, render: (u) => <span className="break-all font-mono text-xs text-muted">{u.email}</span> },
    { key: 'phone', label: 'Phone', render: (u) => <span className="whitespace-nowrap font-mono text-xs text-muted">{u.phone ?? '—'}</span> },
    {
      key: 'roles', label: 'Roles',
      render: (u) => <span className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} variant="neutral" label={STAFF_ROLE_LABEL[r] ?? r} />)}</span>,
    },
    { key: 'status', label: 'Status', render: (u) => <Badge variant={STATUS[u.status].variant} label={STATUS[u.status].label} /> },
    { key: 'lastLoginAt', label: 'Last login', sortable: true, render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-muted">Never</span>) },
    { key: 'createdAt', label: 'Joined', sortable: true, render: (u) => formatDate(u.createdAt) },
    {
      key: 'actions', label: 'Actions',
      render: (u) => (
        <div className="-ml-2.5 flex flex-wrap items-center">
          {props.canUpdate && <button type="button" className={action} onClick={() => openDrawer({ mode: 'edit', user: u })}>Edit</button>}
          {mayManageAccess && <Link href={`/admin/users/${u.id}/access`} className={cn(action, 'inline-flex items-center')}>Manage access</Link>}
          {props.canInvite && u.status === 'invited' && <button type="button" className={action} disabled={busy} onClick={() => newInvite(u)}>New invite</button>}
          {props.canDeactivate && u.id !== props.currentUserId && (
            <button type="button" className={action} onClick={() => setPending({ kind: u.status === 'deactivated' ? 'reactivate' : 'deactivate', user: u })}>
              {u.status === 'deactivated' ? 'Reactivate' : 'Deactivate'}
            </button>
          )}
          {props.canResetPassword && u.status !== 'deactivated' && <button type="button" className={action} onClick={() => setPending({ kind: 'reset', user: u })}>Reset password</button>}
          {props.canTempPassword && u.status !== 'deactivated' && u.id !== props.currentUserId && <button type="button" className={action} onClick={() => setPending({ kind: 'temp', user: u })}>Temporary password</button>}
          {props.canSignOut && u.status === 'active' && u.id !== props.currentUserId && <button type="button" className={action} onClick={() => setPending({ kind: 'signout', user: u })}>Sign out</button>}
          {props.canViewActivity && <Link href={`/system/audit-log?user=${u.id}`} className={cn(action, 'inline-flex items-center')}>View activity</Link>}
        </div>
      ),
    },
  ];

  const tile = (label: string, n: number, status: UserStatus) => (
    <Link
      href={`${pathname}?status=${status}`}
      aria-current={params.get('status') === status ? 'true' : undefined}
      className={cn('block rounded-2xl bg-white p-4 hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', params.get('status') === status && 'ring-2 ring-primary/50')}
    >
      <p className="text-xs font-medium text-subtle">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">{n}</p>
    </Link>
  );

  const message = (name: string, url: string, reset?: boolean) =>
    reset
      ? `Hello ${name}, choose a new password for your ${props.schoolName} account on Pfuma here (the link works once, for 30 minutes): ${url}`
      : `Hello ${name}, you have been added to ${props.schoolName} on Pfuma. Choose your password here (the link works for 72 hours): ${url}`;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:max-w-lg" aria-label="Users by status">
        {tile('Active', props.counts.active, 'active')}
        {tile('Invited', props.counts.invited, 'invited')}
        {tile('Deactivated', props.counts.deactivated, 'deactivated')}
      </div>

      {(props.canCreate || props.canImport) && (
        <div className="flex flex-wrap justify-end gap-2">
          {props.canImport && <Button variant="secondary" onClick={() => { setImportResult(null); setImporting(true); }}>Import users</Button>}
          {props.canCreate && <Button onClick={() => openDrawer({ mode: 'create' })}>Add user</Button>}
        </div>
      )}

      <DataTable
        caption="Users"
        columns={columns}
        rows={props.rows}
        total={props.total}
        page={props.page}
        pageSize={props.pageSize}
        rowKey={(u) => u.id}
        searchPlaceholder="Search name, email or phone"
        filters={[
          { key: 'role', label: 'Role', options: STAFF_ROLES.map((r) => ({ value: r.key, label: r.label })) },
          { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'invited', label: 'Invited' }, { value: 'deactivated', label: 'Deactivated' }] },
        ]}
        exportPath={props.canExport ? '/api/system/users' : undefined}
        emptyTitle="No users yet"
        emptyDescription="Add the first staff account to get started."
        emptyAction={props.canCreate ? <Button onClick={() => openDrawer({ mode: 'create' })}>Add user</Button> : undefined}
      />

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={editing ? 'Edit user' : 'Add user'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawer(null)} disabled={isSubmitting}>Cancel</Button>
            <Button form="user-form" type="submit" loading={isSubmitting}>{editing ? 'Save changes' : signIn === 'INVITE' ? 'Add and make invite' : 'Add and make password'}</Button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-[6rem,1fr] gap-3">
            <Select id="u-title" label="Title" placeholder="None" options={USER_TITLES.map((t) => ({ value: t, label: t }))} {...register('title')} />
            <Input id="u-name" label="Full name" required autoComplete="off" maxLength={80} error={errors.fullName?.message} {...register('fullName')} />
          </div>
          <Input id="u-email" label="Email" type="email" required autoComplete="off" error={errors.email?.message} {...register('email')} />
          <Input id="u-phone" label="Phone" type="tel" required autoComplete="off" placeholder="0771 234 567" hint="Saved as +263…" error={errors.phone?.message} {...register('phone')} />

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">Roles <span className="text-danger" aria-hidden="true">*</span></legend>
            <ul className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              {STAFF_ROLES.map((r) => (
                <li key={r.key}>
                  <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
                    <input type="checkbox" className="h-5 w-5 accent-primary" checked={roles.includes(r.key as never)} onChange={() => toggleRole(r.key)} /> {r.label}
                  </label>
                </li>
              ))}
            </ul>
            {errors.roles?.message && <p role="alert" className="text-xs text-danger">{errors.roles.message}</p>}
          </fieldset>

          {!editing && (
            <fieldset className="rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">Sign-in setup</legend>
              {SIGN_IN_SETUPS.map((v) => (
                <label key={v} className="flex min-h-[44px] items-start gap-3 py-1.5 text-sm text-ink">
                  <input type="radio" value={v} className="mt-0.5 h-5 w-5 accent-primary" {...register('signIn')} />
                  <span>
                    {v === 'INVITE' ? 'Send invite (recommended)' : 'Temporary password'}
                    <span className="block text-xs text-muted">
                      {v === 'INVITE'
                        ? 'A link, valid 72 hours, where the person chooses their own password.'
                        : 'A password made for you to hand over. The person must change it the first time they sign in.'}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </form>
      </Drawer>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'deactivate' ? 'Deactivate user?'
          : pending?.kind === 'reactivate' ? 'Reactivate user?'
          : pending?.kind === 'temp' ? 'Make a temporary password?'
          : pending?.kind === 'signout' ? 'Sign this user out?'
          : 'Reset password?'
        }
        confirmLabel={
          pending?.kind === 'deactivate' ? 'Deactivate'
          : pending?.kind === 'reactivate' ? 'Reactivate'
          : pending?.kind === 'temp' ? 'Make password'
          : pending?.kind === 'signout' ? 'Sign out'
          : 'Reset password'
        }
        destructive={pending?.kind !== 'reactivate'}
        loading={busy}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      >
        {pending?.kind === 'deactivate' && <>{pending.user.fullName} will be signed out and cannot sign in until you reactivate the account.</>}
        {pending?.kind === 'reactivate' && <>{pending.user.fullName} will be able to sign in again.</>}
        {pending?.kind === 'temp' && <>{pending.user.fullName}&apos;s current password stops working and they are signed out everywhere. You will see a temporary password once; they must change it when they next sign in.</>}
        {pending?.kind === 'signout' && <>{pending.user.fullName} will be signed out on every device. They can sign in again with the same password.</>}
        {pending?.kind === 'reset' && <>You will get a link for {pending.user.fullName} to choose a new password. It works once and for 30 minutes, and you will see it only once.</>}
      </ConfirmDialog>

      {/* The invite link or temporary password: shown once, never stored */}
      <Modal open={shown !== null} onClose={() => setShown(null)} title={shown?.title ?? ''} footer={<Button onClick={() => setShown(null)}>Done</Button>}>
        {shown?.kind === 'invite' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Give {shown.user.fullName} this link. It works once and for {shown.invite.reset ? '30 minutes' : '72 hours'}, and they choose their own password with it. It will not be shown again.
            </p>
            <input readOnly aria-label="Invite link" value={shown.invite.url} onFocus={(e) => e.currentTarget.select()} className="min-h-[44px] w-full rounded-xl border border-line bg-rowhover px-3 font-mono text-xs text-primary" />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => copy(shown.invite.url)}>Copy link</Button>
              {shown.user.phone && (
                <a href={buildWhatsAppLink(shown.user.phone, message(shown.user.fullName, shown.invite.url, shown.invite.reset))} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">
                  Send on WhatsApp
                </a>
              )}
              <a href={`mailto:${shown.user.email}?subject=${encodeURIComponent(`Your ${props.schoolName} account on Pfuma`)}&body=${encodeURIComponent(message(shown.user.fullName, shown.invite.url, shown.invite.reset))}`} className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">
                Send by email
              </a>
            </div>
            <p className="rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn">Pfuma does not send e-mail or SMS by itself yet, so pass the link on with one of the buttons above.</p>
          </div>
        )}
        {shown?.kind === 'password' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Share this with {shown.user.fullName}. The password is shown once and cannot be looked up later. They must change it when they first sign in.</p>
            <div className="rounded-xl border border-line bg-rowhover p-4">
              <p className="text-xs font-medium text-muted">Email</p>
              <p className="mt-1 break-all font-mono text-sm text-ink">{shown.user.email}</p>
              <p className="mt-3 text-xs font-medium text-muted">Temporary password</p>
              <p className="mt-1 break-all font-mono text-lg font-bold text-primary">{shown.password}</p>
            </div>
            <Button variant="secondary" onClick={() => copy(shown.password)}>Copy password</Button>
          </div>
        )}
      </Modal>

      {/* Import from a file */}
      <Drawer open={importing} onClose={() => setImporting(false)} title="Import users" footer={<Button onClick={() => setImporting(false)}>Close</Button>}>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted">
            A CSV file with the columns <strong className="text-ink">name, email, phone, roles</strong>. Put more than one role in the roles column with a semicolon, e.g. <span className="font-mono text-xs">Teacher;Class Teacher</span>. Everyone gets an invite link. At most 200 people at a time.
          </p>
          <a href="/api/system/users/import" download className="min-h-[44px] content-center font-medium text-primary hover:underline">Download the template</a>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-ink">Choose the file</span>
            <input
              type="file" accept=".csv,text/csv" disabled={importBusy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void runImport(f); e.target.value = ''; }}
              className="min-h-[44px] rounded-xl border border-line bg-white p-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-tint file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary"
            />
          </label>
          {importBusy && <p aria-live="polite" className="text-muted">Reading the file…</p>}

          {importResult && (
            <section aria-label="Import result" className="flex flex-col gap-3">
              <p className={cn('rounded-xl px-3 py-2 font-medium', importResult.created > 0 ? 'bg-success-bg text-success' : 'bg-warn-bg text-warn')}>
                {importResult.created} added, {importResult.rejected.length} rejected.
              </p>
              {importResult.invites.length > 0 && (
                <>
                  <p className="text-xs text-muted">The invite links are on this screen only. Download them now to pass them on; they cannot be shown again.</p>
                  <Button variant="secondary" onClick={() => download('invite-links.csv', [['Name', 'Email', 'Phone', 'Invite link (valid 72 hours)'], ...importResult.invites.map((i) => [i.fullName, i.email, i.phone, i.url])])}>
                    Download invite links
                  </Button>
                </>
              )}
              {importResult.rejected.length > 0 && (
                <>
                  <div className="overflow-x-auto rounded-xl border border-line">
                    <table className="w-full min-w-[480px] text-left text-xs text-ink">
                      <caption className="sr-only">Rejected rows</caption>
                      <thead className="bg-canvas text-subtle"><tr><th className="px-2 py-2 font-medium">Row</th><th className="px-2 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Email</th><th className="px-2 py-2 font-medium">Why</th></tr></thead>
                      <tbody className="divide-y divide-line">
                        {importResult.rejected.map((r) => (
                          <tr key={r.row}><td className="px-2 py-2">{r.row}</td><td className="px-2 py-2">{r.name || '—'}</td><td className="break-all px-2 py-2">{r.email || '—'}</td><td className="px-2 py-2 text-danger">{r.reason}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button variant="secondary" onClick={() => download('rejected-users.csv', [['Row', 'Name', 'Email', 'Phone', 'Roles', 'Why'], ...importResult.rejected.map((r) => [String(r.row), r.name, r.email, r.phone, r.roles, r.reason])])}>
                    Download rejected rows
                  </Button>
                </>
              )}
            </section>
          )}
        </div>
      </Drawer>
    </>
  );
}
