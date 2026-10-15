'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { ProfileSchema } from '@/lib/validations/system';

type Values = z.output<typeof ProfileSchema>;

export function ProfileForm({ fullName, email, roleLabel, canUpdate, canChangePassword }: { fullName: string; email: string; roleLabel: string; canUpdate: boolean; canChangePassword: boolean }) {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<Values>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: { fullName },
  });

  async function save(values: Values) {
    const res = await fetch('/api/system/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('Profile updated. Your new name shows after you sign in again.');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(save)} className="flex max-w-md flex-col gap-4 rounded-2xl bg-white p-5" noValidate>
      <Input id="p-name" label="Full name" required disabled={!canUpdate} error={errors.fullName?.message} {...register('fullName')} />
      <Input id="p-email" label="Email" value={email} readOnly disabled hint="Ask an administrator to change your email." />
      <Input id="p-role" label="Role" value={roleLabel} readOnly disabled />
      <div className="flex flex-wrap items-center gap-3">
        {canUpdate && <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save</Button>}
        {canChangePassword && <Link href="/change-password" className="min-h-[44px] content-center text-sm font-medium text-primary hover:underline">Change password</Link>}
      </div>
    </form>
  );
}
