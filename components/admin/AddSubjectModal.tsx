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
import { CreateSubjectSchema } from '@/lib/validations/results';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateSubjectSchema>;

const TYPE_OPTIONS = [
  { value: 'CORE', label: 'Core' },
  { value: 'ELECTIVE', label: 'Elective' },
];

export function AddSubjectModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateSubjectSchema),
    defaultValues: { maxMark: 100, type: 'CORE' },
  });

  function handleClose() {
    setOpen(false);
    reset({ maxMark: 100, type: 'CORE' });
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/admin/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        code: values.code.toUpperCase(),
        maxMark: Number(values.maxMark ?? 100),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to add subject');
      return;
    }
    toast.success('Subject added');
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Subject</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add Subject"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button form="add-subject-form" type="submit" loading={isSubmitting}>Add Subject</Button>
          </>
        }
      >
        <form id="add-subject-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="name"
            label="Subject Name"
            required
            placeholder="e.g. Mathematics"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            id="code"
            label="Code"
            required
            placeholder="e.g. MATH"
            hint="A short unique code for this subject"
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
    </>
  );
}
