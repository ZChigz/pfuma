'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

const GRADE_OPTIONS = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
];

export interface FeeStructureOption {
  id: string;
  label: string;
  grade: string;
  term: string;
  currency: 'USD' | 'ZIG';
  amount: number;
}

interface Props {
  feeStructure?: FeeStructureOption;
}

export function FeeStructureModal({ feeStructure }: Props) {
  const isEdit = !!feeStructure;
  const [open, setOpen] = useState(false);
  const [grade, setGrade] = useState(feeStructure?.grade ?? '');
  const [term, setTerm] = useState(feeStructure?.term ?? '');
  const [label, setLabel] = useState(feeStructure?.label ?? '');
  const [currency, setCurrency] = useState<'USD' | 'ZIG'>(feeStructure?.currency ?? 'USD');
  const [amount, setAmount] = useState(feeStructure ? String(feeStructure.amount) : '');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function handleClose() {
    setOpen(false);
    if (!isEdit) {
      setGrade(''); setTerm(''); setLabel(''); setCurrency('USD'); setAmount('');
    }
  }

  const valid = !!grade && !!term.trim() && !!label.trim() && Number(amount) > 0;

  async function handleSubmit() {
    setBusy(true);
    try {
      const url    = isEdit ? `/api/accounting/fee-structures/${feeStructure!.id}` : '/api/accounting/fee-structures';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, term, label: label.trim(), currency, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to save fee structure');
        return;
      }
      toast.success(isEdit ? 'Fee structure updated' : 'Fee structure added');
      handleClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={isEdit ? 'secondary' : 'primary'} size={isEdit ? 'sm' : 'md'} onClick={() => setOpen(true)}>
        {isEdit ? 'Edit' : 'Add fee structure'}
      </Button>

      <Modal
        open={open}
        onClose={handleClose}
        title={isEdit ? 'Edit Fee Structure' : 'Add Fee Structure'}
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={busy}>Cancel</Button>
            <Button onClick={handleSubmit} loading={busy} disabled={!valid}>
              {isEdit ? 'Save changes' : 'Add'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            id="fs-grade"
            label="Grade"
            required
            options={GRADE_OPTIONS.map((g) => ({ value: g, label: g }))}
            placeholder="Select a grade"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
          <Input
            id="fs-term"
            label="Term"
            required
            placeholder="e.g. Term 1 2026"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <Input
            id="fs-label"
            label="Label"
            required
            placeholder="e.g. Tuition Fee"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              id="fs-currency"
              label="Currency"
              required
              options={[{ value: 'USD', label: 'USD' }, { value: 'ZIG', label: 'ZiG' }]}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as 'USD' | 'ZIG')}
            />
            <Input
              id="fs-amount"
              label="Amount"
              required
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
