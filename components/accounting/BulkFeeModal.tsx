'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatUSD, formatZiG } from '@/lib/utils';

const GRADE_OPTIONS = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
];

interface FeeStructureOption {
  id: string;
  label: string;
  grade: string;
  term: string;
  currency: 'USD' | 'ZIG';
  amount: number;
}

interface ClassOption {
  id: string;
  name: string;
  grade: string;
}

interface Props {
  feeStructures: FeeStructureOption[];
  classes: ClassOption[];
}

type Scope = 'class' | 'grade';

export function BulkFeeModal({ feeStructures, classes }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [scope, setScope] = useState<Scope>('grade');
  const [classId, setClassId] = useState('');
  const [grade, setGrade] = useState('');
  const [feeStructureId, setFeeStructureId] = useState('');
  const [term, setTerm] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [result, setResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const targetGrade = scope === 'class' ? classes.find((c) => c.id === classId)?.grade : grade;
  const matchingFeeStructures = feeStructures.filter((f) => !targetGrade || f.grade === targetGrade);
  const selectedFeeStructure = feeStructures.find((f) => f.id === feeStructureId);

  function reset() {
    setStep(1);
    setScope('grade');
    setClassId('');
    setGrade('');
    setFeeStructureId('');
    setTerm('');
    setPreviewCount(null);
    setResult(null);
  }

  function handleClose() {
    setOpen(false);
    reset();
  }

  async function goToPreview() {
    setBusy(true);
    try {
      const qs = scope === 'class' ? `classId=${classId}` : `grade=${encodeURIComponent(grade)}`;
      const res = await fetch(`/api/admin/students?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to load students');
        return;
      }
      const count = (data.data.students as { active: boolean }[]).filter((s) => s.active).length;
      setPreviewCount(count);
      setStep(4);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const res = await fetch('/api/accounting/fees/bulk-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          ...(scope === 'class' ? { classId } : { grade }),
          feeStructureId,
          term,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to apply fees');
        return;
      }
      setResult(data.data);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const step1Valid = scope === 'class' ? !!classId : !!grade;
  const step2Valid = !!feeStructureId;
  const step3Valid = !!term.trim();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Apply Fees by Grade</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Apply Fees in Bulk"
        footer={
          result ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              {step > 1 && (
                <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                  Back
                </Button>
              )}
              <Button variant="secondary" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              {step < 3 && (
                <Button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                >
                  Next
                </Button>
              )}
              {step === 3 && (
                <Button onClick={goToPreview} loading={busy} disabled={!step3Valid}>
                  Preview
                </Button>
              )}
              {step === 4 && (
                <Button onClick={handleConfirm} loading={busy}>
                  Confirm &amp; Apply
                </Button>
              )}
            </>
          )
        }
      >
        {result ? (
          <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-4 text-sm">
            <p className="font-medium text-[#15803d]">
              Applied to {result.applied} student(s).
            </p>
            {result.skipped > 0 && (
              <p className="mt-1 text-[#78716c]">{result.skipped} student(s) already had this charge for {term}.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs font-medium text-[#78716c]">
              {['Scope', 'Fee Structure', 'Term', 'Confirm'].map((label, i) => (
                <span
                  key={label}
                  className={i + 1 === step ? 'text-[#065f46]' : i + 1 < step ? 'text-[#15803d]' : ''}
                >
                  {i + 1}. {label}{i < 3 ? ' →' : ''}
                </span>
              ))}
            </div>

            {/* Step 1: Scope */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-[#292524]">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === 'grade'}
                      onChange={() => { setScope('grade'); setFeeStructureId(''); }}
                      className="h-4 w-4 text-[#065f46] focus:ring-[#065f46]/30"
                    />
                    By Grade
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-[#292524]">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === 'class'}
                      onChange={() => { setScope('class'); setFeeStructureId(''); }}
                      className="h-4 w-4 text-[#065f46] focus:ring-[#065f46]/30"
                    />
                    By Class
                  </label>
                </div>
                {scope === 'grade' ? (
                  <Select
                    id="bulk-grade"
                    label="Grade"
                    required
                    options={GRADE_OPTIONS.map((g) => ({ value: g, label: g }))}
                    placeholder="Select a grade"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                  />
                ) : (
                  <Select
                    id="bulk-class"
                    label="Class"
                    required
                    options={classes.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Select a class"
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                  />
                )}
              </div>
            )}

            {/* Step 2: Fee structure */}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                <Select
                  id="bulk-fee-structure"
                  label="Fee Structure"
                  required
                  options={matchingFeeStructures.map((f) => ({
                    value: f.id,
                    label: `${f.label} — ${f.currency === 'USD' ? formatUSD(f.amount) : formatZiG(f.amount)} (${f.grade}, ${f.term})`,
                  }))}
                  placeholder="Select a fee structure"
                  value={feeStructureId}
                  onChange={(e) => setFeeStructureId(e.target.value)}
                  hint={matchingFeeStructures.length === 0 ? `No fee structures defined for ${targetGrade}.` : undefined}
                />
              </div>
            )}

            {/* Step 3: Term */}
            {step === 3 && (
              <div className="flex flex-col gap-4">
                <Input
                  id="bulk-term"
                  label="Term"
                  required
                  placeholder="e.g. Term 1 2026"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  hint="The charge will be recorded against this term."
                />
              </div>
            )}

            {/* Step 4: Preview / confirm */}
            {step === 4 && (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-4 text-sm">
                  <p>
                    <span className="font-medium text-[#292524]">Scope: </span>
                    {scope === 'class' ? classes.find((c) => c.id === classId)?.name : grade}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-[#292524]">Fee: </span>
                    {selectedFeeStructure?.label} —{' '}
                    {selectedFeeStructure && (selectedFeeStructure.currency === 'USD'
                      ? formatUSD(selectedFeeStructure.amount)
                      : formatZiG(selectedFeeStructure.amount))}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-[#292524]">Term: </span>
                    {term}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-[#292524]">Students affected: </span>
                    {previewCount ?? '—'}
                  </p>
                </div>
                <p className="text-xs text-[#78716c]">
                  Students who already have a &quot;{selectedFeeStructure?.label}&quot; charge for {term} will be skipped.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
