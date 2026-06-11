'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { CreateUserSchema } from '@/lib/validations/admin';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateUserSchema>;

const ROLE_OPTIONS = [
  { value: 'ADMIN',     label: 'Admin' },
  { value: 'DIRECTOR',  label: 'Director' },
  { value: 'HEAD',      label: 'Head Teacher' },
  { value: 'BURSAR',    label: 'Bursar' },
  { value: 'TEACHER',   label: 'Teacher' },
  { value: 'LIBRARIAN', label: 'Librarian' },
];

export function AddUserModal() {
  const [open, setOpen] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({ resolver: zodResolver(CreateUserSchema) });

  function handleClose() {
    setOpen(false);
    reset();
  }

  function handleCloseCredentials() {
    setCredentials(null);
    router.refresh();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to add user');
      return;
    }
    handleClose();
    setCredentials({ email: data.data.user.email, tempPassword: data.data.tempPassword });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add User</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add User"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button form="add-user-form" type="submit" loading={isSubmitting}>
              Add User
            </Button>
          </>
        }
      >
        <form id="add-user-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="fullName"
            label="Full Name"
            required
            placeholder="e.g. Tendai Moyo"
            error={errors.fullName?.message}
            {...register('fullName')}
          />
          <Input
            id="email"
            label="Email"
            type="email"
            required
            placeholder="e.g. tendai@school.co.zw"
            error={errors.email?.message}
            {...register('email')}
          />
          <Select
            id="role"
            label="Role"
            required
            options={ROLE_OPTIONS}
            placeholder="Select a role"
            error={errors.role?.message}
            {...register('role')}
          />
          <p className="text-xs text-[#78716c]">
            A temporary password will be generated automatically and shown once after the user is created.
          </p>
        </form>
      </Modal>

      <Modal
        open={credentials != null}
        onClose={handleCloseCredentials}
        title="User Created"
        footer={<Button onClick={handleCloseCredentials}>Done</Button>}
      >
        {credentials && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#78716c]">
              Share these credentials with the user. The password will not be shown again.
            </p>
            <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Email</p>
              <p className="mt-1 font-mono text-sm text-[#292524]">{credentials.email}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">Temporary Password</p>
              <p className="mt-1 font-mono text-lg font-bold tracking-wide text-[#065f46]">{credentials.tempPassword}</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
