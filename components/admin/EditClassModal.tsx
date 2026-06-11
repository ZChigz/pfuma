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
import { UpdateClassSchema } from '@/lib/validations/admin';
import type { z } from 'zod';

type FormValues = z.infer<typeof UpdateClassSchema>;

const GRADE_OPTIONS = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
].map((g) => ({ value: g, label: g }));

interface Teacher {
  id: string;
  fullName: string;
}

interface SchoolClassData {
  id: string;
  grade: string;
  section: string | null;
  classTeacherId: string | null;
  active: boolean;
}

interface Props {
  schoolClass: SchoolClassData;
  teachers: Teacher[];
}

export function EditClassModal({ schoolClass, teachers }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(UpdateClassSchema),
    defaultValues: {
      grade: schoolClass.grade,
      section: schoolClass.section ?? '',
      classTeacherId: schoolClass.classTeacherId ?? '',
      active: schoolClass.active,
    },
  });

  function handleClose() {
    setOpen(false);
    reset();
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch(`/api/admin/classes/${schoolClass.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        section: values.section || null,
        classTeacherId: values.classTeacherId || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to update class');
      return;
    }
    toast.success('Class updated');
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Edit Class</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Edit Class"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button form="edit-class-form" type="submit" loading={isSubmitting}>
              Save Changes
            </Button>
          </>
        }
      >
        <form id="edit-class-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
          <label className="flex items-center gap-2 text-sm font-medium text-[#292524]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[#e7e5e4] text-[#065f46] focus:ring-[#065f46]/30"
              {...register('active')}
            />
            Active
          </label>
        </form>
      </Modal>
    </>
  );
}
