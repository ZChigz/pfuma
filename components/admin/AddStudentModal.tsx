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
import { CreateAdminStudentSchema } from '@/lib/validations/admin';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateAdminStudentSchema>;

interface ClassOption {
  id: string;
  name: string;
}

interface Props {
  classes: ClassOption[];
  defaultClassId?: string;
}

export function AddStudentModal({ classes, defaultClassId }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAdminStudentSchema),
    defaultValues: { classId: defaultClassId ?? '' },
  });

  function handleClose() {
    setOpen(false);
    reset({ classId: defaultClassId ?? '' });
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/admin/students', {
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
            <Button form="add-admin-student-form" type="submit" loading={isSubmitting}>
              Add Student
            </Button>
          </>
        }
      >
        <form id="add-admin-student-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Input
            id="fullName"
            label="Full Name"
            required
            placeholder="e.g. Tendai Moyo"
            error={errors.fullName?.message}
            {...register('fullName')}
          />
          <Select
            id="classId"
            label="Class"
            required
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select a class"
            error={errors.classId?.message}
            {...register('classId')}
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
