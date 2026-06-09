'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { AssignTeacherSchema } from '@/lib/validations/results';
import type { z } from 'zod';

type FormValues = z.infer<typeof AssignTeacherSchema>;

interface Teacher { id: string; fullName: string }
interface Subject { id: string; name: string; code: string; grade: string }

interface Props {
  subject:     Subject;
  teachers:    Teacher[];
  currentTerm: string;
}

export function AssignTeacherModal({ subject, teachers, currentTerm }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast  = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(AssignTeacherSchema),
    defaultValues: { subjectId: subject.id, term: currentTerm },
  });

  function handleClose() { setOpen(false); reset({ subjectId: subject.id, term: currentTerm }); }

  async function onSubmit(values: FormValues) {
    const res  = await fetch('/api/results/assignments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.message ?? 'Failed to assign teacher'); return; }
    toast.success('Teacher assigned');
    handleClose();
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded px-2 py-1 text-xs font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
      >
        Assign Teacher
      </button>

      <Modal
        open={open}
        onClose={handleClose}
        title={`Assign Teacher — ${subject.name} (${subject.grade})`}
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button form="assign-teacher-form" type="submit" loading={isSubmitting}>Assign</Button>
          </>
        }
      >
        <form id="assign-teacher-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <input type="hidden" {...register('subjectId')} />
          <Select
            id="teacherId"
            label="Teacher"
            required
            options={teachers.map((t) => ({ value: t.id, label: t.fullName }))}
            placeholder="Select a teacher"
            error={errors.teacherId?.message}
            {...register('teacherId')}
          />
          <Input
            id="term"
            label="Term"
            required
            placeholder="e.g. Term 1 2025"
            error={errors.term?.message}
            {...register('term')}
          />
        </form>
      </Modal>
    </>
  );
}
