'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

interface Option { id: string; name: string }

interface Props {
  teachers: { id: string; fullName: string }[];
  levels: Option[];
  defaultCapacity: number;
}

export function AddClassModal({ teachers, levels, defaultCapacity }: Props) {
  const [open, setOpen] = useState(false);
  const [levelId, setLevelId] = useState('');
  const [stream, setStream] = useState('');
  const [capacity, setCapacity] = useState(String(defaultCapacity));
  const [classTeacherId, setClassTeacherId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function handleClose() {
    setOpen(false);
    setLevelId(''); setStream(''); setCapacity(String(defaultCapacity)); setClassTeacherId(''); setErrors({});
  }

  async function onSubmit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch('/api/admin/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          levelId,
          stream: stream.trim(),
          capacity: Number(capacity),
          ...(classTeacherId ? { classTeacherId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const fieldErrs = Object.fromEntries(Object.entries(data.errors ?? {}).map(([k, v]) => [k, (v as string[])[0]]));
        setErrors(fieldErrs);
        if (!Object.keys(fieldErrs).length) toast.error(data.message ?? 'Failed to add class');
        return;
      }
      toast.success('Class created');
      handleClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const levelName = levels.find((l) => l.id === levelId)?.name;

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Class</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add Class"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={busy}>Cancel</Button>
            <Button onClick={onSubmit} loading={busy} disabled={!levelId}>Add Class</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            id="levelId"
            label="Level"
            required
            options={levels.map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Select a level"
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
            error={errors.levelId}
          />
          <Input
            id="stream"
            label="Stream"
            placeholder="e.g. North"
            value={stream}
            onChange={(e) => setStream(e.target.value)}
            hint={levelName ? `The class will be called "${stream.trim() ? `${levelName} ${stream.trim()}` : levelName}". Leave blank if this level has one class.` : 'Distinguishes classes in the same level, e.g. North, South, East'}
            error={errors.stream}
          />
          <Input
            id="capacity"
            label="Capacity"
            type="number"
            min={1}
            max={200}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            hint="Admitting beyond this shows a warning"
            error={errors.capacity}
          />
          <Select
            id="classTeacherId"
            label="Class Teacher"
            options={teachers.map((t) => ({ value: t.id, label: t.fullName }))}
            placeholder="Select a teacher (optional)"
            value={classTeacherId}
            onChange={(e) => setClassTeacherId(e.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}
