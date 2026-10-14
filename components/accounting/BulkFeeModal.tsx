'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatUSD, formatZiG } from '@/lib/utils';
import type { FeeStructureOption, LevelOption, TermOption } from './FeeStructureModal';

interface ClassOption {
  id: string;
  name: string;
  levelId: string;
}

interface Props {
  feeStructures: FeeStructureOption[];
  classes: ClassOption[];
  levels: LevelOption[];
  terms: TermOption[];
}

type Scope = 'class' | 'level';

// Charges go to students enrolled in the class/level for the chosen term.
export function BulkFeeModal({ feeStructures, classes, levels, terms }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [scope, setScope] = useState<Scope>('level');
  const [classId, setClassId] = useState('');
  const [levelId, setLevelId] = useState('');
  const [feeStructureId, setFeeStructureId] = useState('');
  const [termId, setTermId] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [result, setResult] = useState<{ applied: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const targetLevelId = scope === 'class' ? classes.find((c) => c.id === classId)?.levelId : levelId;
  const targetName = scope === 'class' ? classes.find((c) => c.id === classId)?.name : levels.find((l) => l.id === levelId)?.name;
  const matchingFeeStructures = feeStructures.filter((f) => !f.levelId || f.levelId === targetLevelId);
  const selectedFeeStructure = feeStructures.find((f) => f.id === feeStructureId);
  const termName = terms.find((t) => t.id === termId)?.name ?? '';

  function reset() {
    setStep(1);
    setScope('level');
    setClassId('');
    setLevelId('');
    setFeeStructureId('');
    setTermId('');
    setPreviewCount(null);
    setResult(null);
  }

  function handleClose() {
    setOpen(false);
    reset();
  }

  function chooseFeeStructure(id: string) {
    setFeeStructureId(id);
    // Default the term to the fee structure's own term.
    setTermId(feeStructures.find((f) => f.id === id)?.termId ?? '');
  }

  async function goToPreview() {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ termId, ...(scope === 'class' ? { classId } : { levelId }) });
      const res = await fetch(`/api/admin/students?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to load students');
        return;
      }
      setPreviewCount((data.data.students as unknown[]).length);
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
          ...(scope === 'class' ? { classId } : { levelId }),
          feeStructureId,
          termId,
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

  const step1Valid = scope === 'class' ? !!classId : !!levelId;
  const step2Valid = !!feeStructureId;
  const step3Valid = !!termId;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Apply Fees by Level</Button>

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
          <div className="rounded-xl border border-line bg-rowhover p-4 text-sm">
            <p className="font-medium text-success">
              Applied to {result.applied} student(s).
            </p>
            {result.skipped > 0 && (
              <p className="mt-1 text-muted">{result.skipped} student(s) already had this charge for {termName}.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Step indicator */}
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              {['Scope', 'Fee Structure', 'Term', 'Confirm'].map((label, i) => (
                <span
                  key={label}
                  className={i + 1 === step ? 'text-primary' : i + 1 < step ? 'text-success' : ''}
                >
                  {i + 1}. {label}{i < 3 ? ' →' : ''}
                </span>
              ))}
            </div>

            {/* Step 1: Scope */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === 'level'}
                      onChange={() => { setScope('level'); setFeeStructureId(''); }}
                      className="h-4 w-4 text-primary focus:ring-primary/30"
                    />
                    By Level
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="radio"
                      name="scope"
                      checked={scope === 'class'}
                      onChange={() => { setScope('class'); setFeeStructureId(''); }}
                      className="h-4 w-4 text-primary focus:ring-primary/30"
                    />
                    By Class
                  </label>
                </div>
                {scope === 'level' ? (
                  <Select
                    id="bulk-level"
                    label="Level"
                    required
                    options={levels.map((l) => ({ value: l.id, label: l.name }))}
                    placeholder="Select a level"
                    value={levelId}
                    onChange={(e) => setLevelId(e.target.value)}
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
                    label: `${f.label} — ${f.currency === 'USD' ? formatUSD(f.amount) : formatZiG(f.amount)} (${f.levelName}, ${f.termName})`,
                  }))}
                  placeholder="Select a fee structure"
                  value={feeStructureId}
                  onChange={(e) => chooseFeeStructure(e.target.value)}
                  hint={matchingFeeStructures.length === 0 ? `No fee structures defined for ${targetName}.` : undefined}
                />
              </div>
            )}

            {/* Step 3: Term */}
            {step === 3 && (
              <div className="flex flex-col gap-4">
                <Select
                  id="bulk-term"
                  label="Term"
                  required
                  placeholder="Select a term"
                  options={terms.filter((t) => t.status !== 'CLOSED').map((t) => ({ value: t.id, label: t.status === 'OPEN' ? `${t.name} (current)` : t.name }))}
                  value={termId}
                  onChange={(e) => setTermId(e.target.value)}
                  hint="Students enrolled in that term are charged, and the charge is recorded against it."
                />
              </div>
            )}

            {/* Step 4: Preview / confirm */}
            {step === 4 && (
              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-line bg-rowhover p-4 text-sm">
                  <p>
                    <span className="font-medium text-ink">Scope: </span>
                    {targetName}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-ink">Fee: </span>
                    {selectedFeeStructure?.label} —{' '}
                    {selectedFeeStructure && (selectedFeeStructure.currency === 'USD'
                      ? formatUSD(selectedFeeStructure.amount)
                      : formatZiG(selectedFeeStructure.amount))}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-ink">Term: </span>
                    {termName}
                  </p>
                  <p className="mt-1">
                    <span className="font-medium text-ink">Students enrolled: </span>
                    {previewCount ?? '—'}
                  </p>
                </div>
                <p className="text-xs text-muted">
                  Students who already have a &quot;{selectedFeeStructure?.label}&quot; charge for {termName} will be skipped.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
