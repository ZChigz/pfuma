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
  DEFAULT_STREAMS,
  defaultRegistrationValues,
  GENDER_OPTIONS,
  LEVELS,
  normalizeName,
  OTHER_SUBURB,
  RegisterStudentSchema,
  RELATIONSHIP_OPTIONS,
  SUBURBS,
  todayInHarare,
  type AdmissionData,
  type RegisterStudentInput,
  type RegistrationWarning,
  type WarningCode,
} from '@/lib/students/registration';

interface ClassOption {
  id: string;
  name: string;
  level: string;
  stream: string;
  capacity: number;
  studentCount: number; // in the open term
}

interface Props {
  classes: ClassOption[];
  disabled?: boolean; // no open term
}

interface ReviewState {
  student: AdmissionData;
  className: string;
  classExists: boolean;
  classCount: number;
  capacity: number;
  termName: string | null;
  warnings: RegistrationWarning[];
}

type Step = 'form' | 'review' | 'saved';

const toOptions = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  const cls = tone === 'warn'
    ? 'border-warn-line bg-warn-bg text-warn'
    : 'border-line bg-rowhover text-muted';
  return <p className={`rounded-md border px-3 py-2 text-xs ${cls}`}>{children}</p>;
}

export function AddStudentModal({ classes, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [review, setReview] = useState<ReviewState | null>(null);
  const [accepted, setAccepted] = useState<Set<WarningCode>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ admissionNumber: string; fullName: string; className: string } | null>(null);
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
  } = useForm<RegisterStudentInput, unknown, AdmissionData>({
    resolver: zodResolver(RegisterStudentSchema),
    defaultValues: defaultRegistrationValues(),
    mode: 'onTouched',
  });

  const [level, stream, dateOfBirth, surname, relationship, suburb] = watch([
    'level', 'stream', 'dateOfBirth', 'surname', 'guardianRelationship', 'suburb',
  ]);

  // Streams offered for the chosen level: existing classes first, then the defaults.
  const streamSuggestions = useMemo(() => {
    const existing = classes.filter((c) => c.level === level && c.stream).map((c) => c.stream);
    return Array.from(new Set([...existing, ...DEFAULT_STREAMS]));
  }, [classes, level]);

  // ── Class name + occupancy (live) ──────────────────────────────────────────
  const trimmedStream = (stream ?? '').trim();
  const selectedClass = useMemo(() => {
    if (!level || !trimmedStream) return null;
    return classes.find((c) => c.level === level && c.stream.toLowerCase() === trimmedStream.toLowerCase()) ?? null;
  }, [classes, level, trimmedStream]);
  const liveClassName = level && trimmedStream ? selectedClass?.name ?? buildClassName(level, normalizeName(trimmedStream)) : '';
  const liveCount = selectedClass?.studentCount ?? 0;
  const liveCapacity = selectedClass?.capacity;
  const classIsFull = !!selectedClass && liveCount + 1 > selectedClass.capacity;

  const liveAgeWarning = dateOfBirth && level ? ageWarning(dateOfBirth, level) : null;

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
    for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
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
      if (!res.ok) return toast.error(body.message ?? 'Failed to admit student');

      const s = body.data.student;
      setSaved({ admissionNumber: s.admissionNumber, fullName: s.fullName, className: s.currentClass?.name ?? review.className });
      setStep('saved');
      toast.success('Student admitted');
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
        <Button onClick={handleSave} loading={saving} disabled={!allWarningsAccepted}>Confirm &amp; admit</Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={resetAll}>Admit another</Button>
        <Button onClick={handleClose}>Done</Button>
      </>
    );

  const title = step === 'form' ? 'Admit Student' : step === 'review' ? 'Confirm Student Details' : 'Student Admitted';

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>+ Admit Student</Button>

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
                  <Select id="level" label="Level" required placeholder="Select level" options={toOptions(LEVELS)}
                    error={errors.level?.message} {...register('level')} />
                  <div>
                    <Input id="stream" label="Stream" required placeholder="e.g. North" list="stream-suggestions"
                      error={errors.stream?.message} {...register('stream')} />
                    <datalist id="stream-suggestions">
                      {streamSuggestions.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <Input id="admissionDate" label="Admission date" type="date" required max={todayInHarare()}
                    hint="The year sets the admission number"
                    error={errors.admissionDate?.message} {...register('admissionDate')} />
                </div>
                <Input id="className" label="Class" readOnly value={liveClassName}
                  placeholder="Filled in from level and stream" className="bg-canvas"
                  hint={liveClassName
                    ? (selectedClass ? `${liveCount} of ${liveCapacity} places taken this term` : 'This class will be created when you save')
                    : undefined} />
                {classIsFull && (
                  <Notice tone="warn">
                    {liveClassName} is at or over capacity ({liveCount}/{liveCapacity}). You can still admit this student, but you will be asked to confirm.
                  </Notice>
                )}
              </Section>

              <Section title="Guardian">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input id="guardianName" label="Guardian full name" required placeholder="e.g. Rudo Moyo"
                    hint="Surname filled in from the student — add the guardian's first name"
                    error={errors.guardianName?.message} {...register('guardianName')} />
                  <Select id="guardianRelationship" label="Relationship to student" required placeholder="Select relationship"
                    options={RELATIONSHIP_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                    error={errors.guardianRelationship?.message} {...register('guardianRelationship')} />
                  {relationship === 'OTHER' && (
                    <Input id="guardianRelationshipOther" label="Describe relationship" required placeholder="e.g. Stepfather"
                      error={errors.guardianRelationshipOther?.message} {...register('guardianRelationshipOther')} />
                  )}
                  <Input id="guardianPhone" label="Guardian phone" required type="tel" inputMode="tel"
                    placeholder="0771234567 or +263771234567"
                    hint="Saved as +263XXXXXXXXX. Brothers and sisters with the same guardian share one record."
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

              <details className="group rounded-lg border border-line px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-ink">Optional details</summary>
                <div className="mt-4 flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input id="birthCertificateNumber" label="Birth certificate number"
                      hint="Must be unique in the school"
                      error={errors.birthCertificateNumber?.message} {...register('birthCertificateNumber')} />
                    <Input id="previousSchool" label="Previous school"
                      error={errors.previousSchool?.message} {...register('previousSchool')} />
                    <Input id="guardianAltPhone" label="Guardian alternative phone" type="tel" inputMode="tel"
                      placeholder="0771234567"
                      error={errors.guardianAltPhone?.message} {...register('guardianAltPhone')} />
                    <Input id="guardianEmail" label="Guardian email" type="email"
                      error={errors.guardianEmail?.message} {...register('guardianEmail')} />
                    <Input id="guardianNationalId" label="Guardian national ID"
                      error={errors.guardianNationalId?.message} {...register('guardianNationalId')} />
                    <Input id="guardianOccupation" label="Guardian occupation"
                      error={errors.guardianOccupation?.message} {...register('guardianOccupation')} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="medicalNotes" className="text-sm font-medium text-ink">Medical conditions / allergies</label>
                    <textarea id="medicalNotes" rows={3} placeholder="e.g. Asthma — carries an inhaler"
                      aria-invalid={!!errors.medicalNotes}
                      className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
                      {...register('medicalNotes')} />
                    {errors.medicalNotes && <p role="alert" className="text-xs text-danger">{errors.medicalNotes.message}</p>}
                  </div>
                  <FileUpload key={uploadKey} endpoint="studentPhoto" label="Student photo"
                    onUpload={(url) => setValue('photoUrl', url, { shouldValidate: true })} />
                  {errors.photoUrl && <p role="alert" className="text-xs text-danger">{errors.photoUrl.message}</p>}
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
              <p className="text-sm text-ink">
                <span className="font-medium">{saved.fullName}</span> has been admitted to {saved.className}.
              </p>
              <Input id="admissionNumber" label="Admission number" readOnly value={saved.admissionNumber}
                className="bg-canvas font-mono text-base"
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
  const relationship = s.relationship === 'OTHER'
    ? s.relationshipNote ?? 'Other'
    : RELATIONSHIP_OPTIONS.find((r) => r.value === s.relationship)?.label ?? s.relationship;

  const groups: { title: string; rows: [string, string | number | null][] }[] = [
    { title: 'Student', rows: [
      ['First name', s.firstName], ['Surname', s.surname], ['Gender', gender], ['Date of birth', s.dateOfBirth],
    ] },
    { title: 'Class', rows: [
      ['Class', review.className + (review.classExists ? '' : ' (new class)')],
      ['Term', review.termName],
      ['Students in class', review.classExists ? `${review.classCount} of ${review.capacity}` : '0'],
      ['Admission date', s.admissionDate],
      ['Admission number', 'Generated when you save'],
    ] },
    { title: 'Guardian', rows: [
      ['Name', s.guardian.fullName], ['Relationship', relationship], ['Phone', s.guardian.phone],
      ['Alternative phone', s.guardian.altPhone], ['Email', s.guardian.email],
      ['National ID', s.guardian.nationalId], ['Occupation', s.guardian.occupation],
    ] },
    { title: 'Address', rows: [['Address', s.address]] },
    { title: 'Optional details', rows: [
      ['Birth certificate no.', s.birthCertificateNumber], ['Previous school', s.previousSchool],
      ['Medical / allergies', s.medicalNotes], ['Photo', s.photoUrl ? 'Uploaded' : null],
    ] },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">Check everything below. Names, phone numbers and the address are shown exactly as they will be saved.</p>

      {review.warnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warn-line bg-warn-bg p-4">
          <p className="text-sm font-semibold text-warn">Please confirm before saving</p>
          {review.warnings.map((w) => (
            <label key={w.code} className="flex items-start gap-2 text-sm text-warn">
              <input
                type="checkbox"
                checked={accepted.has(w.code)}
                onChange={() => onToggle(w.code)}
                className="mt-0.5 h-4 w-4 rounded border-warn-line text-primary focus:ring-primary/30"
              />
              <span>{w.message} <span className="font-medium">I have checked this — save anyway.</span></span>
            </label>
          ))}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[180px_1fr]">
            {g.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="break-words text-ink">{value === null || value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
