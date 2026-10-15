'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { ROLE_LABELS } from '@/lib/role-labels';
import { SystemCreateUserSchema } from '@/lib/validations/system';

export interface UserRowData {
  id: string;
  fullName: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
}

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

type FormInput = z.input<typeof SystemCreateUserSchema>;
type FormOutput = z.output<typeof SystemCreateUserSchema>;

interface Props {
  rows: UserRowData[];
  total: number;
  page: number;
  pageSize: number;
  currentUserId: string;
  // All from can() on the server.
  canCreate: boolean;
  canUpdate: boolean;
  canDeactivate: boolean;
  canResetPassword: boolean;
  canExport: boolean;
}

type Pending = { kind: 'deactivate' | 'reactivate' | 'reset'; user: UserRowData } | null;

export function UsersClient(props: Props) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'edit'; user: UserRowData } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(SystemCreateUserSchema),
  });

  function openDrawer(next: NonNullable<typeof drawer>) {
    reset(next.mode === 'edit' ? { fullName: next.user.fullName, email: next.user.email, role: next.user.role as FormInput['role'] } : { fullName: '', email: '', role: undefined });
    setDrawer(next);
  }

  async function save(values: FormOutput) {
    const edit = drawer?.mode === 'edit' ? drawer.user : null;
    const res = await fetch(edit ? `/api/system/users/${edit.id}` : '/api/system/users', {
      method: edit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save the user');
      return;
    }
    setDrawer(null);
    if (!edit) setSecret({ title: 'User added', email: body.data.user.email, password: body.data.tempPassword });
    else toast.success('User updated');
    router.refresh();
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/system/users/${pending.user.id}/${pending.kind === 'reset' ? 'reset-password' : pending.kind}`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.message ?? 'That did not work');
        return;
      }
      if (pending.kind === 'reset') setSecret({ title: 'Password reset', email: pending.user.email, password: body.data.tempPassword });
      else toast.success(pending.kind === 'deactivate' ? 'User deactivated' : 'User reactivated');
      setPending(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const actionClass = 'min-h-[44px] rounded-lg px-2.5 text-xs font-semibold text-primary hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

  const columns: DataColumn<UserRowData>[] = [
    { key: 'fullName', label: 'Name', sortable: true, render: (u) => <span className="font-medium">{u.fullName}{u.id === props.currentUserId && <span className="ml-1.5 text-xs text-muted">(you)</span>}</span> },
    { key: 'email', label: 'Email', sortable: true, render: (u) => <span className="break-all font-mono text-xs text-muted">{u.email}</span> },
    { key: 'role', label: 'Role', sortable: true, render: (u) => <Badge variant="neutral" label={ROLE_LABELS[u.role] ?? u.role} /> },
    { key: 'active', label: 'Status', sortable: true, render: (u) => <Badge variant={u.active ? 'success' : 'danger'} label={u.active ? 'Active' : 'Inactive'} /> },
    { key: 'createdAt', label: 'Added', sortable: true, render: (u) => formatDate(u.createdAt) },
    {
      key: 'actions',
      label: 'Actions',
      render: (u) => (
        <div className="-ml-2.5 flex flex-wrap items-center">
          {props.canUpdate && <button type="button" className={actionClass} onClick={() => openDrawer({ mode: 'edit', user: u })}>Edit</button>}
          {props.canDeactivate && u.id !== props.currentUserId && (
            <button type="button" className={actionClass} onClick={() => setPending({ kind: u.active ? 'deactivate' : 'reactivate', user: u })}>
              {u.active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
          {props.canResetPassword && u.active && <button type="button" className={actionClass} onClick={() => setPending({ kind: 'reset', user: u })}>Reset password</button>}
        </div>
      ),
    },
  ];

  const editing = drawer?.mode === 'edit';

  return (
    <>
      {props.canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => openDrawer({ mode: 'create' })}>Add user</Button>
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
        searchPlaceholder="Search name or email"
        filters={[
          { key: 'role', label: 'Role', options: ROLE_OPTIONS },
          { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
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
            <Button form="user-form" type="submit" loading={isSubmitting}>{editing ? 'Save changes' : 'Add user'}</Button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
          <Input id="u-name" label="Full name" required autoComplete="off" error={errors.fullName?.message} {...register('fullName')} />
          <Input id="u-email" label="Email" type="email" required autoComplete="off" error={errors.email?.message} {...register('email')} />
          <Select id="u-role" label="Role" required options={ROLE_OPTIONS} placeholder="Select a role" error={errors.role?.message} {...register('role')} />
          {!editing && <p className="text-xs text-muted">A temporary password is created and shown once. The user must replace it at first sign-in.</p>}
        </form>
      </Drawer>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'deactivate' ? 'Deactivate user?' : pending?.kind === 'reactivate' ? 'Reactivate user?' : 'Reset password?'}
        confirmLabel={pending?.kind === 'deactivate' ? 'Deactivate' : pending?.kind === 'reactivate' ? 'Reactivate' : 'Reset password'}
        destructive={pending?.kind !== 'reactivate'}
        loading={busy}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      >
        {pending?.kind === 'deactivate' && <>{pending.user.fullName} will be signed out and will not be able to sign in until you reactivate the account.</>}
        {pending?.kind === 'reactivate' && <>{pending.user.fullName} will be able to sign in again.</>}
        {pending?.kind === 'reset' && <>{pending.user.fullName} will be signed out of every device and given a new temporary password, which you will see once.</>}
      </ConfirmDialog>

      <Modal open={secret !== null} onClose={() => setSecret(null)} title={secret?.title ?? ''} footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
        {secret && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Share this with the user. The password is shown once and cannot be looked up later.</p>
            <div className="rounded-xl border border-line bg-rowhover p-4">
              <p className="text-xs font-medium text-muted">Email</p>
              <p className="mt-1 break-all font-mono text-sm text-ink">{secret.email}</p>
              <p className="mt-3 text-xs font-medium text-muted">Temporary password</p>
              <p className="mt-1 break-all font-mono text-lg font-bold text-primary">{secret.password}</p>
            </div>
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(secret.password).then(() => toast.info('Copied'), () => toast.error('Could not copy'))}>Copy password</Button>
          </div>
        )}
      </Modal>
    </>
  );
}
