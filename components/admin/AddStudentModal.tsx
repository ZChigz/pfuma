'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FileUpload } from '@/components/ui/FileUpload';
import { useToast } from '@/components/ui/Toast';
import {
  ageWarning,
  className as buildClassName,
  currentYearInHarare,
  defaultRegistrationValues,
  FORMS,
  GENDER_OPTIONS,
  normalizeName,
  OTHER_SUBURB,
  RegisterStudentSchema,
  RELATIONSHIPS,
  STREAMS,
  STUDENT_STATUS_OPTIONS,
  SUBURBS,
  todayInHarare,
  type RegisterStudentData,
  type RegisterStudentInput,
  type RegistrationWarning,
  type WarningCode,
} from '@/lib/students/registration';

interface ClassOption {
  id: string;
  name: string;
  grade: string;
  section: string | null;
  studentCount: number; // active students
}

interface Props {
  classes: ClassOption[];
  maxClassSize: number;
}

interface ReviewState {
  student: RegisterStudentData;
  className: string;
  classExists: boolean;
  classCount: number;
  maxClassSize: number;
  warnings: RegistrationWarning[];
}

type Step = 'form' | 'review' | 'saved';

const toOptions = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#78716c]">{title}</legend>
      {children}
    </fieldset>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  const cls = tone === 'warn'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-[#e7e5e4] bg-[#fafaf9] text-[#57534e]';
  return <p className={`rounded-md border px-3 py-2 text-xs ${cls}`}>{children}</p>;
}

export function AddStudentModal({ classes, maxClassSize }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [review, setReview] = useState<ReviewState | null>(null);
  const [accepted, setAccepted] = useState<Set<WarningCode>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ studentNumber: string; fullName: string; className: string } | null>(null);
  const [uploadKey, setUploadKey] = useState(0);
  const router = useRouter();
  const toast = useToast();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RegisterStudentInput, unknown, RegisterStudentData>({
    resolver: zodResolver(RegisterStudentSchema),
    defaultValues: defaultRegistrationValues(),
    mode: 'onTouched',
  });

  const [form, stream, dateOfBirth, surname, relationship, suburb, status] = watch([
    'form', 'stream', 'dateOfBirth', 'surname', 'guardianRelationship', 'suburb', 'status',
  ]);

  // ── Class name + occupancy (live) ──────────────────────────────────────────
  const selectedClass = useMemo(() => {
    if (!form || !stream) return null;
    return (
      classes.find((c) => c.grade === form && c.section?.toLowerCase() === stream.toLowerCase()) ??
      classes.find((c) => c.name === buildClassName(form, stream)) ??
      null
    );
  }, [classes, form, stream]);
  const liveClassName = form && stream ? selectedClass?.name ?? buildClassName(form, stream) : '';
  const liveCount = selectedClass?.studentCount ?? 0;
  const classIsFull = !!liveClassName && status === 'ACTIVE' && liveCount + 1 > maxClassSize;

  const liveAgeWarning = dateOfBirth && form ? ageWarning(dateOfBirth, form) : null;

  // ── Pre-fill guardian surname until the admin edits the field ─────────────
  const lastPrefill = useRef('');
  useEffect(() => {
    const current = getValues('guardianName') ?? '';
    if (current !== '' && current !== lastPrefill.current) return;
    const next = normalizeName(surname ?? '');
    lastPrefill.current = next;
    setValue('guardianName', next);
  }, [surname, getValues, setValue]);

  function resetAll() {
    reset(defaultRegistrationValues());
    lastPrefill.current = '';
    setStep('form');
    setReview(null);
    setAccepted(new Set());
    setSaved(null);
    setUploadKey((k) => k + 1);
  }

  function handleClose() {
    setOpen(false);
    resetAll();
  }

  function showServerErrors(fieldErrors: Record<string, string[]> | undefined, message?: string) {
    const entries = Object.entries(fieldErrors ?? {});
    for (const [field, messages] of entries) {
      setError(field as keyof RegisterStudentInput, { type: 'server', message: messages[0] });
    }
    toast.error(message ?? 'Please fix the highlighted fields');
  }

  // Step 1 → 2: validate on the server too and fetch warnings.
  async function goToReview() {
    const res = await fetch('/api/admin/students/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: getValues() }),
    });
    const body = await res.json();
    if (res.status === 422) return showServerErrors(body.errors, body.message);
    if (!res.ok) return toast.error(body.message ?? 'Could not check the details. Please try again.');
    setReview(body.data);
    setAccepted(new Set());
    setStep('review');
  }

  // Step 2 → 3: save.
  async function handleSave() {
    if (!review) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student: getValues(), acknowledgedWarnings: Array.from(accepted) }),
      });
      const body = await res.json();
      if (res.status === 409 && body.warnings) {
        // Something changed since the review (e.g. the class filled up).
        setReview({ ...review, warnings: body.warnings });
        toast.error('Please review the updated warnings before saving');
        return;
      }
      if (res.status === 422) {
        setStep('form');
        return showServerErrors(body.errors, body.message);
      }
      if (!res.ok) return toast.error(body.message ?? 'Failed to register student');

      const s = body.data.student;
      setSaved({ studentNumber: s.studentNumber, fullName: s.fullName, className: s.class?.name ?? review.className });
      setStep('saved');
      toast.success('Student registered');
      router.refresh();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const allWarningsAccepted = !!review && review.warnings.every((w) => accepted.has(w.code));

  // ── Footer per step ────────────────────────────────────────────────────────
  const footer =
    step === 'form' ? (
      <>
        <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
        <Button form="register-student-form" type="submit" loading={isSubmitting}>Review details</Button>
      </>
    ) : step === 'review' ? (
      <>
        <Button variant="secondary" onClick={() => setStep('form')} disabled={saving}>Back to edit</Button>
        <Button onClick={handleSave} loading={saving} disabled={!allWarningsAccepted}>Confirm &amp; save</Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={resetAll}>Register another</Button>
        <Button onClick={handleClose}>Done</Button>
      </>
    );

  const title = step === 'form' ? 'Register Student' : step === 'review' ? 'Confirm Student Details' : 'Student Registered';

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Register Student</Button>

      <Modal open={open} onClose={handleClose} title={title} size="lg" footer={footer}>
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {/* ── Step 1: form ───────────────────────────────────────────── */}
          {step === 'form' && (
            <form id="register-student-form" noValidate onSubmit={handleSubmit(goToReview)} className="flex flex-col gap-6">
              <Section title="Student">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="firstName" label="First name" required placeholder="e.g. Tatenda"
                    error={errors.firstName?.message} {...register('firstName')} />
                  <Input id="surname" label="Surname" required placeholder="e.g. Moyo"
                    error={errors.surname?.message} {...register('surname')} />
                  <Select id="gender" label="Gender" required placeholder="Select gender"
                    options={GENDER_OPTIONS.map((g) => ({ value: g.value, label: g.label }))}
                    error={errors.gender?.message} {...register('gender')} />
                  <Input id="dateOfBirth" label="Date of birth" type="date" required max={todayInHarare()}
                    error={errors.dateOfBirth?.message} {...register('dateOfBirth')} />
                </div>
                {liveAgeWarning && !errors.dateOfBirth && <Notice tone="warn">{liveAgeWarning} You can still continue.</Notice>}
              </Section>

              <Section title="Class">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Select id="form" label="Form" required placeholder="Select form" options={toOptions(FORMS)}
                    error={errors.form?.message} {...register('form')} />
                  <Select id="stream" label="Stream" required placeholder="Select stream" options={toOptions(STREAMS)}
                    error={errors.stream?.message} {...register('stream')} />
                  <Input id="enrollmentYear" label="Enrollment year" type="number" required
                    min={2000} max={currentYearInHarare()}
                    hint="Change only for transfer students"
                    error={errors.enrollmentYear?.message} {...register('enrollmentYear')} />
                </div>
                <Input id="className" label="Class" readOnly value={liveClassName}
                  placeholder="Filled in from form and stream" className="bg-stone-50"
                  hint={liveClassName
                    ? `${liveCount} of ${maxClassSize} places taken${selectedClass ? '' : ' — this class will be created when you save'}`
                    : undefined} />
                {classIsFull && (
                  <Notice tone="warn">
                    {liveClassName} is at or over its limit ({liveCount}/{maxClassSize}). You can still register this student, but you will be asked to confirm.
                  </Notice>
                )}
                <Select id="status" label="Status" required options={STUDENT_STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                  error={errors.status?.message} {...register('status')} />
              </Section>

              <Section title="Guardian">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="guardianName" label="Guardian full name" required placeholder="e.g. Rudo Moyo"
                    hint="Surname filled in from the student — add the guardian's first name"
                    error={errors.guardianName?.message} {...register('guardianName')} />
                  <Select id="guardianRelationship" label="Relationship to student" required placeholder="Select relationship"
                    options={toOptions(RELATIONSHIPS)}
                    error={errors.guardianRelationship?.message} {...register('guardianRelationship')} />
                  {relationship === 'Other' && (
                    <Input id="guardianRelationshipOther" label="Describe relationship" required placeholder="e.g. Stepfather"
                      error={errors.guardianRelationshipOther?.message} {...register('guardianRelationshipOther')} />
                  )}
                  <Input id="guardianPhone" label="Guardian phone" required type="tel" inputMode="tel"
                    placeholder="0771234567 or +263771234567"
                    hint="Saved as +263XXXXXXXXX"
                    error={errors.guardianPhone?.message} {...register('guardianPhone')} />
                </div>
              </Section>

              <Section title="Address">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input id="houseNumber" label="House / stand number" required placeholder="e.g. 1234"
                    error={errors.houseNumber?.message} {...register('houseNumber')} />
                  <Select id="suburb" label="Suburb" required placeholder="Select suburb" options={toOptions(SUBURBS)}
                    error={errors.suburb?.message} {...register('suburb')} />
                  <Input id="city" label="City" required
                    error={errors.city?.message} {...register('city')} />
                </div>
                {suburb === OTHER_SUBURB && (
                  <Input id="suburbOther" label="Suburb name" required placeholder="Type the suburb"
                    error={errors.suburbOther?.message} {...register('suburbOther')} />
                )}
              </Section>

              <details className="group rounded-lg border border-[#e7e5e4] px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-[#292524]">Optional details</summary>
                <div className="mt-4 flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input id="birthCertificateNumber" label="Birth certificate number"
                      error={errors.birthCertificateNumber?.message} {...register('birthCertificateNumber')} />
                    <Input id="previousSchool" label="Previous school"
                      error={errors.previousSchool?.message} {...register('previousSchool')} />
                    <Input id="secondGuardianPhone" label="Second guardian phone" type="tel" inputMode="tel"
                      placeholder="0771234567"
                      error={errors.secondGuardianPhone?.message} {...register('secondGuardianPhone')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="medicalNotes" className="text-sm font-medium text-[#292524]">Medical conditions / allergies</label>
                    <textarea id="medicalNotes" rows={3} placeholder="e.g. Asthma — carries an inhaler"
                      aria-invalid={!!errors.medicalNotes}
                      className="rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm text-[#292524] placeholder:text-[#78716c] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
                      {...register('medicalNotes')} />
                    {errors.medicalNotes && <p role="alert" className="text-xs text-[#b91c1c]">{errors.medicalNotes.message}</p>}
                  </div>
                  <FileUpload key={uploadKey} endpoint="studentPhoto" label="Student photo"
                    onUpload={(url) => setValue('photoUrl', url, { shouldValidate: true })} />
                  {errors.photoUrl && <p role="alert" className="text-xs text-[#b91c1c]">{errors.photoUrl.message}</p>}
                </div>
              </details>
            </form>
          )}

          {/* ── Step 2: confirmation ───────────────────────────────────── */}
          {step === 'review' && review && (
            <ReviewDetails
              review={review}
              accepted={accepted}
              onToggle={(code) => setAccepted((prev) => {
                const next = new Set(prev);
                if (next.has(code)) next.delete(code); else next.add(code);
                return next;
              })}
            />
          )}

          {/* ── Step 3: saved ──────────────────────────────────────────── */}
          {step === 'saved' && saved && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[#292524]">
                <span className="font-medium">{saved.fullName}</span> has been registered in {saved.className}.
              </p>
              <Input id="studentNumber" label="Student ID" readOnly value={saved.studentNumber}
                className="bg-stone-50 font-mono text-base"
                hint="Generated automatically and cannot be changed." />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

// ─── Confirmation screen ─────────────────────────────────────────────────────

function ReviewDetails({
  review,
  accepted,
  onToggle,
}: {
  review: ReviewState;
  accepted: Set<WarningCode>;
  onToggle: (code: WarningCode) => void;
}) {
  const s = review.student;
  const gender = GENDER_OPTIONS.find((g) => g.value === s.gender)?.label ?? s.gender;
  const status = STUDENT_STATUS_OPTIONS.find((o) => o.value === s.status)?.label ?? s.status;

  const groups: { title: string; rows: [string, string | number | null][] }[] = [
    { title: 'Student', rows: [
      ['First name', s.firstName], ['Surname', s.surname], ['Gender', gender], ['Date of birth', s.dateOfBirth],
    ] },
    { title: 'Class', rows: [
      ['Class', review.className + (review.classExists ? '' : ' (new class)')],
      ['Students in class', `${review.classCount} of ${review.maxClassSize}`],
      ['Enrollment year', s.enrollmentYear], ['Status', status],
      ['Student ID', 'Generated when you save'],
    ] },
    { title: 'Guardian', rows: [
      ['Name', s.guardianName], ['Relationship', s.guardianRelationship], ['Phone', s.guardianPhone],
    ] },
    { title: 'Address', rows: [['Address', s.address]] },
    { title: 'Optional details', rows: [
      ['Birth certificate no.', s.birthCertificateNumber], ['Previous school', s.previousSchool],
      ['Second guardian phone', s.secondGuardianPhone], ['Medical / allergies', s.medicalNotes],
      ['Photo', s.photoUrl ? 'Uploaded' : null],
    ] },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[#78716c]">Check everything below. Names, phone numbers and the address are shown exactly as they will be saved.</p>

      {review.warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Please confirm before saving</p>
          {review.warnings.map((w) => (
            <label key={w.code} className="flex items-start gap-2 text-sm text-amber-900">
              <input
                type="checkbox"
                checked={accepted.has(w.code)}
                onChange={() => onToggle(w.code)}
                className="mt-0.5 h-4 w-4 rounded border-amber-300 text-[#065f46] focus:ring-[#065f46]/30"
              />
              <span>{w.message} <span className="font-medium">I have checked this — save anyway.</span></span>
            </label>
          ))}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#78716c]">{g.title}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[180px_1fr]">
            {g.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-[#78716c]">{label}</dt>
                <dd className="break-words text-[#292524]">{value === null || value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
