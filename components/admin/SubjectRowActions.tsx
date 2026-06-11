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
import { UpdateSubjectSchema } from '@/lib/validations/results';
import type { z } from 'zod';

type FormValues = z.infer<typeof UpdateSubjectSchema>;

const TYPE_OPTIONS = [
  { value: 'CORE', label: 'Core' },
  { value: 'ELECTIVE', label: 'Elective' },
];

interface SubjectData {
  id: string;
  name: string;
  code: string;
  maxMark: number;
  type: 'CORE' | 'ELECTIVE';
  active: boolean;
}

interface Props {
  subject: SubjectData;
}

export function SubjectRowActions({ subject }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(UpdateSubjectSchema),
    defaultValues: {
      name: subject.name,
      code: subject.code,
      maxMark: subject.maxMark,
      type: subject.type,
    },
  });

  function handleClose() {
    setOpen(false);
    reset({ name: subject.name, code: subject.code, maxMark: subject.maxMark, type: subject.type });
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/admin/subjects/${subject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        code: values.code?.toUpperCase(),
        maxMark: values.maxMark !== undefined ? Number(values.maxMark) : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to update subject');
      return;
    }
    toast.success('Subject updated');
    handleClose();
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/subjects/${subject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !subject.active }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to update subject');
        return;
      }
      toast.success(subject.active ? 'Subject deactivated' : 'Subject reactivated');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={toggleActive}
        disabled={busy}
        className="rounded px-2 py-1 text-xs font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 disabled:opacity-50"
      >
        {subject.active ? 'Deactivate' : 'Reactivate'}
      </button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Edit Subject"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button form="edit-subject-form" type="submit" loading={isSubmitting}>Save Changes</Button>
          </>
        }
      >
        <form id="edit-subject-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Subject Name"
            required
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            id="code"
            label="Code"
            required
            error={errors.code?.message}
            {...register('code')}
          />
          <Input
            id="maxMark"
            label="Max Mark"
            type="number"
            min={1}
            error={errors.maxMark?.message}
            {...register('maxMark', { valueAsNumber: true })}
          />
          <Select
            id="type"
            label="Type"
            options={TYPE_OPTIONS}
            error={errors.type?.message}
            {...register('type')}
          />
        </form>
      </Modal>
    </div>
  );
}
