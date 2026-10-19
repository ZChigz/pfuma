'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

// "" in the level dropdown means the fee applies to every level.
const ALL_LEVELS = '';

export interface FeeStructureOption {
  id: string;
  label: string;
  levelId: string | null;
  levelName: string;   // "All levels" when levelId is null
  termId: string;
  termName: string;
  currency: 'USD' | 'ZIG';
  amount: number;
}

export interface LevelOption { id: string; name: string }
export interface TermOption { id: string; name: string; status: 'PLANNED' | 'OPEN' | 'CLOSED' }

interface Props {
  feeStructure?: FeeStructureOption;
  levels: LevelOption[];
  terms: TermOption[];
}

export function FeeStructureModal({ feeStructure, levels, terms }: Props) {
  const isEdit = !!feeStructure;
  const openTermId = terms.find((t) => t.status === 'OPEN')?.id ?? '';
  const [open, setOpen] = useState(false);
  const [levelId, setLevelId] = useState(feeStructure?.levelId ?? ALL_LEVELS);
  const [termId, setTermId] = useState(feeStructure?.termId ?? openTermId);
  const [label, setLabel] = useState(feeStructure?.label ?? '');
  const [currency, setCurrency] = useState<'USD' | 'ZIG'>(feeStructure?.currency ?? 'USD');
  const [amount, setAmount] = useState(feeStructure ? String(feeStructure.amount) : '');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function handleClose() {
    setOpen(false);
    if (!isEdit) {
      setLevelId(ALL_LEVELS); setTermId(openTermId); setLabel(''); setCurrency('USD'); setAmount('');
    }
  }

  const valid = !!termId && !!label.trim() && Number(amount) > 0;

  async function handleSubmit() {
    setBusy(true);
    try {
      const url    = isEdit ? `/api/accounting/fee-structures/${feeStructure!.id}` : '/api/accounting/fee-structures';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelId: levelId || null, termId, label: label.trim(), currency, amount: Number(amount) }),
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
            id="fs-level"
            label="Level"
            options={[{ value: ALL_LEVELS, label: 'All levels' }, ...levels.map((l) => ({ value: l.id, label: l.name }))]}
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
          />
          <Select
            id="fs-term"
            label="Term"
            required
            placeholder="Select a term"
            options={terms.filter((t) => t.status !== 'CLOSED' || t.id === feeStructure?.termId)
              .map((t) => ({ value: t.id, label: t.status === 'OPEN' ? `${t.name} (current)` : t.name }))}
            value={termId}
            onChange={(e) => setTermId(e.target.value)}
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
