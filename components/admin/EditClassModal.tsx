'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

interface SchoolClassData {
  id: string;
  levelId: string;
  stream: string;
  capacity: number;
  classTeacherId: string | null;
  active: boolean;
  hasHistory: boolean; // level is locked once students have been enrolled
}

interface Props {
  schoolClass: SchoolClassData;
  teachers: { id: string; fullName: string }[];
  levels: { id: string; name: string }[];
}

export function EditClassModal({ schoolClass, teachers, levels }: Props) {
  const [open, setOpen] = useState(false);
  const [levelId, setLevelId] = useState(schoolClass.levelId);
  const [stream, setStream] = useState(schoolClass.stream);
  const [capacity, setCapacity] = useState(String(schoolClass.capacity));
  const [classTeacherId, setClassTeacherId] = useState(schoolClass.classTeacherId ?? '');
  const [active, setActive] = useState(schoolClass.active);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function handleClose() {
    setOpen(false);
    setErrors({});
  }

  async function onSubmit() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(`/api/admin/classes/${schoolClass.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          levelId,
          stream: stream.trim(),
          capacity: Number(capacity),
          classTeacherId: classTeacherId || null,
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const fieldErrs = Object.fromEntries(Object.entries(data.errors ?? {}).map(([k, v]) => [k, (v as string[])[0]]));
        setErrors(fieldErrs);
        if (!Object.keys(fieldErrs).length) toast.error(data.message ?? 'Failed to update class');
        return;
      }
      toast.success('Class updated');
      handleClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
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
            <Button variant="secondary" onClick={handleClose} disabled={busy}>Cancel</Button>
            <Button onClick={onSubmit} loading={busy}>Save Changes</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            id="levelId"
            label="Level"
            required
            options={levels.map((l) => ({ value: l.id, label: l.name }))}
            value={levelId}
            onChange={(e) => setLevelId(e.target.value)}
            disabled={schoolClass.hasHistory}
            hint={schoolClass.hasHistory ? 'Locked because students have been in this class. Create a new class for a different level.' : undefined}
            error={errors.levelId}
          />
          <Input id="stream" label="Stream" placeholder="e.g. North" value={stream} onChange={(e) => setStream(e.target.value)} error={errors.stream} />
          <Input id="capacity" label="Capacity" type="number" min={1} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} error={errors.capacity} />
          <Select
            id="classTeacherId"
            label="Class Teacher"
            options={teachers.map((t) => ({ value: t.id, label: t.fullName }))}
            placeholder="Select a teacher (optional)"
            value={classTeacherId}
            onChange={(e) => setClassTeacherId(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
        </div>
      </Modal>
    </>
  );
}
