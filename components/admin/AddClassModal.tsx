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
import { CreateClassSchema } from '@/lib/validations/admin';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateClassSchema>;

const GRADE_OPTIONS = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
].map((g) => ({ value: g, label: g }));

interface Teacher {
  id: string;
  fullName: string;
}

interface Props {
  teachers: Teacher[];
}

export function AddClassModal({ teachers }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({ resolver: zodResolver(CreateClassSchema) });

  function handleClose() {
    setOpen(false);
    reset();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/admin/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to add class');
      return;
    }
    toast.success('Class created');
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Class</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add Class"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button form="add-class-form" type="submit" loading={isSubmitting}>
              Add Class
            </Button>
          </>
        }
      >
        <form id="add-class-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Select
            id="grade"
            label="Grade"
            required
            options={GRADE_OPTIONS}
            placeholder="Select a grade"
            error={errors.grade?.message}
            {...register('grade')}
          />
          <Input
            id="section"
            label="Section"
            placeholder="e.g. A (optional)"
            hint="Used to distinguish multiple classes in the same grade, e.g. Form 4A, Form 4B"
            error={errors.section?.message}
            {...register('section')}
          />
          <Select
            id="classTeacherId"
            label="Class Teacher"
            options={teachers.map((t) => ({ value: t.id, label: t.fullName }))}
            placeholder="Select a teacher (optional)"
            error={errors.classTeacherId?.message}
            {...register('classTeacherId')}
          />
        </form>
      </Modal>
    </>
  );
}
