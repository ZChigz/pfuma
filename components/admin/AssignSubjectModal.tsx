'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { CreateAssignmentSchema } from '@/lib/validations/results';
import type { z } from 'zod';

type FormValues = z.infer<typeof CreateAssignmentSchema>;

interface SubjectOption { id: string; name: string; code: string }
interface TeacherOption { id: string; fullName: string; assignmentCount: number }
interface TeacherLoadEntry { id: string; class: { name: string }; subject: { name: string } }

interface Props {
  classId:   string;
  className: string;
  term:      string;
  subjects:  SubjectOption[];
  teachers:  TeacherOption[];
}

export function AssignSubjectModal({ classId, className, term, subjects, teachers }: Props) {
  const [open, setOpen] = useState(false);
  const [teacherLoad, setTeacherLoad] = useState<TeacherLoadEntry[]>([]);
  const [loadingLoad, setLoadingLoad] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAssignmentSchema),
    defaultValues: { classId, term, subjectId: '', teacherId: '' },
  });

  const selectedTeacherId = watch('teacherId');
  const selectedTerm = watch('term');

  useEffect(() => {
    if (!open || !selectedTeacherId || !selectedTerm) {
      setTeacherLoad([]);
      return;
    }
    setLoadingLoad(true);
    fetch(`/api/admin/assignments/teacher-load?teacherId=${selectedTeacherId}&term=${encodeURIComponent(selectedTerm)}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.success) setTeacherLoad(body.data.assignments);
      })
      .finally(() => setLoadingLoad(false));
  }, [open, selectedTeacherId, selectedTerm]);

  function handleClose() {
    setOpen(false);
    setTeacherLoad([]);
    reset({ classId, term, subjectId: '', teacherId: '' });
  }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/admin/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to assign subject');
      return;
    }
    const subjectName = subjects.find((s) => s.id === values.subjectId)?.name ?? 'Subject';
    toast.success(`${subjectName} assigned to ${className}`);
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={subjects.length === 0}>
        Assign subject
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title={`Assign Subject — ${className}`}
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button form="assign-subject-form" type="submit" loading={isSubmitting}>Assign</Button>
          </>
        }
      >
        <form id="assign-subject-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <input type="hidden" {...register('classId')} />
          <Select
            id="subjectId"
            label="Subject"
            required
            options={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
            placeholder="Select a subject"
            error={errors.subjectId?.message}
            {...register('subjectId')}
          />
          <Select
            id="teacherId"
            label="Teacher"
            required
            options={teachers.map((t) => ({
              value: t.id,
              label: `${t.fullName} (${t.assignmentCount} assignment${t.assignmentCount === 1 ? '' : 's'} this term)`,
            }))}
            placeholder="Select a teacher"
            error={errors.teacherId?.message}
            {...register('teacherId')}
          />
          <Input
            id="term"
            label="Term"
            required
            error={errors.term?.message}
            {...register('term')}
          />

          {selectedTeacherId && (
            <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                This teacher&apos;s current assignments this term
              </p>
              {loadingLoad ? (
                <p className="mt-2 text-sm text-[#78716c]">Loading…</p>
              ) : teacherLoad.length === 0 ? (
                <p className="mt-2 text-sm text-[#78716c]">No assignments yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1 text-sm text-[#292524]">
                  {teacherLoad.map((a) => (
                    <li key={a.id}>{a.class.name} — {a.subject.name}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
