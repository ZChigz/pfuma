'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { FileUpload } from '@/components/ui/FileUpload';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { PASSWORD_MIN_LENGTH } from '@/lib/password-rules';
import { ProfileSchema } from '@/lib/validations/system';

type Values = z.input<typeof ProfileSchema>;

interface Props {
  fullName: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  roles: { key: string; name: string; description: string }[];
  canUpdate: boolean;
  canChangePassword: boolean;
}

export function ProfileForm({ fullName, email, phone, photoUrl, roles, canUpdate, canChangePassword }: Props) {
  const router = useRouter();
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting, isDirty } } = useForm<Values>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: { fullName, phone, photoUrl: photoUrl ?? '' },
  });
  const photo = watch('photoUrl');

  async function save(values: Values) {
    const res = await fetch('/api/system/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('Profile updated.');
    router.refresh();
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <form onSubmit={handleSubmit(save)} className="flex flex-col gap-4 rounded-2xl bg-white p-5" noValidate aria-label="My details">
        <div className="flex items-center gap-4">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="My photo" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-tint text-xl font-semibold text-primary" aria-hidden="true">{fullName.slice(0, 1).toUpperCase()}</span>
          )}
          {canUpdate && (
            <div className="min-w-0 flex-1">
              <FileUpload endpoint="profilePhoto" existingUrl={photo || undefined} onUpload={(url) => setValue('photoUrl', url, { shouldDirty: true, shouldValidate: true })} />
              {photo && (
                <button type="button" onClick={() => setValue('photoUrl', '', { shouldDirty: true })} className="min-h-[44px] text-xs font-medium text-danger hover:underline">
                  Remove photo
                </button>
              )}
              {errors.photoUrl?.message && <p role="alert" className="text-xs text-danger">{errors.photoUrl.message}</p>}
            </div>
          )}
        </div>
        <Input id="p-name" label="Full name" required disabled={!canUpdate} error={errors.fullName?.message} {...register('fullName')} />
        <Input id="p-phone" label="Mobile number" type="tel" inputMode="tel" required disabled={!canUpdate} hint="For example 0771 234 567" error={errors.phone?.message} {...register('phone')} />
        <Input id="p-email" label="Email" value={email} readOnly disabled hint="Ask an administrator to change your email." />
        {canUpdate && <div><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save</Button></div>}
      </form>

      <section className="rounded-2xl bg-white p-5" aria-labelledby="my-roles">
        <h2 id="my-roles" className="text-sm font-semibold text-ink">My roles</h2>
        {roles.length === 0 ? (
          <p className="mt-2 text-sm text-muted">You have no role yet. Ask an administrator.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {roles.map((r) => (
              <li key={r.key} className="py-2">
                <p className="text-sm font-medium text-ink">{r.name}</p>
                <p className="text-sm text-muted">{r.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canChangePassword && <PasswordForm />}
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < PASSWORD_MIN_LENGTH) return setError(`Your new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (next !== confirm) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      const res = await fetch('/api/account/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.message ?? 'Could not change the password.');
      // Changing the password ends every session, this one too.
      await signOut({ callbackUrl: '/login' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Change my password" className="flex flex-col gap-4 rounded-2xl bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">Change my password</h2>
      <Input id="pw-current" type="password" autoComplete="current-password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input id="pw-new" type="password" autoComplete="new-password" label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters. You will be asked to sign in again.`} value={next} onChange={(e) => setNext(e.target.value)} />
      <Input id="pw-confirm" type="password" autoComplete="new-password" label="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && <p role="alert" className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}
      <div><Button type="submit" loading={busy}>Change password</Button></div>
    </form>
  );
}
