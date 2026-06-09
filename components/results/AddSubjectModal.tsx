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

const GRADE_OPTIONS = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
].map((g) => ({ value: g, label: g }));

export function AddSubjectModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast  = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateSubjectSchema),
    defaultValues: { type: 'CORE' },
  });

  function handleClose() { setOpen(false); reset(); }

  async function onSubmit(values: FormValues) {
    const res  = await fetch('/api/results/subjects', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...values, maxMark: Number(values.maxMark) }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.message ?? 'Failed to add subject'); return; }
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
            label="Subject Code"
            required
            placeholder="e.g. MATH01"
            error={errors.code?.message}
            {...register('code')}
          />
          <Select
            id="grade"
            label="Grade"
            required
            options={GRADE_OPTIONS}
            placeholder="Select grade"
            error={errors.grade?.message}
            {...register('grade')}
          />
          <Input
            id="maxMark"
            label="Maximum Mark"
            required
            type="number"
            placeholder="100"
            error={errors.maxMark?.message}
            {...register('maxMark', { valueAsNumber: true })}
          />
          <Select
            id="type"
            label="Type"
            required
            options={[
              { value: 'CORE',     label: 'Core' },
              { value: 'ELECTIVE', label: 'Elective' },
            ]}
            error={errors.type?.message}
            {...register('type')}
          />
        </form>
      </Modal>
    </>
  );
}
