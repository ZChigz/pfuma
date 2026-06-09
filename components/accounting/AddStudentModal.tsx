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
import { CreateStudentSchema } from '@/lib/validations/accounting';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateStudentSchema>;

const GRADE_OPTIONS = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
].map((g) => ({ value: g, label: g }));

export function AddStudentModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({ resolver: zodResolver(CreateStudentSchema) });

  function handleClose() {
    setOpen(false);
    reset();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/accounting/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to add student');
      return;
    }
    toast.success('Student added successfully');
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Student</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add Student"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button form="add-student-form" type="submit" loading={isSubmitting}>
              Add Student
            </Button>
          </>
        }
      >
        <form id="add-student-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="fullName"
            label="Full Name"
            required
            placeholder="e.g. Tendai Moyo"
            error={errors.fullName?.message}
            {...register('fullName')}
          />
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
            id="parentName"
            label="Parent / Guardian Name"
            required
            placeholder="e.g. Mai Moyo"
            error={errors.parentName?.message}
            {...register('parentName')}
          />
          <Input
            id="parentPhone"
            label="Parent Phone"
            required
            placeholder="+263 77 123 4567"
            error={errors.parentPhone?.message}
            {...register('parentPhone')}
          />
        </form>
      </Modal>
    </>
  );
}
