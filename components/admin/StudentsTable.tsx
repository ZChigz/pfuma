'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

interface ClassOption {
  id: string;
  name: string;
}

interface StudentRow {
  id: string;
  fullName: string;
  parentName: string;
  parentPhone: string;
  active: boolean;
  class: { id: string; name: string } | null;
}

interface Props {
  students: StudentRow[];
  classes: ClassOption[];
}

export function StudentsTable({ students, classes }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetClassId, setTargetClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const allSelected = students.length > 0 && selected.size === students.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(students.map((s) => s.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openMoveModal() {
    setTargetClassId('');
    setMoveOpen(true);
  }

  function closeMoveModal() {
    setMoveOpen(false);
  }

  async function handleMove() {
    if (!targetClassId) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/students/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: Array.from(selected), classId: targetClassId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to move students');
        return;
      }
      toast.success(`Moved ${data.data.moved} student(s)`);
      setSelected(new Set());
      closeMoveModal();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const classOptions = useMemo(
    () => classes.map((c) => ({ value: c.id, label: c.name })),
    [classes],
  );

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-[#e7e5e4] bg-[#fafaf9] px-4 py-2">
          <p className="text-sm text-[#292524]">{selected.size} student(s) selected</p>
          <Button size="sm" variant="secondary" onClick={openMoveModal}>
            Move to Class
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
        <table className="w-full text-left text-sm text-[#292524]">
          <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all students"
                  className="h-4 w-4 rounded border-[#e7e5e4] text-[#065f46] focus:ring-[#065f46]/30"
                />
              </th>
              {['Name', 'Parent', 'Phone', 'Class', 'Active'].map((h, i) => (
                <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e7e5e4] bg-white">
            {students.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleOne(s.id)}
                    aria-label={`Select ${s.fullName}`}
                    className="h-4 w-4 rounded border-[#e7e5e4] text-[#065f46] focus:ring-[#065f46]/30"
                  />
                </td>
                <td className="px-4 py-3 font-medium">{s.fullName}</td>
                <td className="px-4 py-3">{s.parentName}</td>
                <td className="px-4 py-3 font-mono text-xs text-[#78716c]">{s.parentPhone}</td>
                <td className="px-4 py-3">{s.class?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge label={s.active ? 'Active' : 'Inactive'} variant={s.active ? 'success' : 'danger'} />
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#78716c]">
                  No students found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={moveOpen}
        onClose={closeMoveModal}
        title="Move Students"
        footer={
          <>
            <Button variant="secondary" onClick={closeMoveModal} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={handleMove} loading={busy} disabled={!targetClassId}>
              Move
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#78716c]">
            Move {selected.size} selected student(s) to a different class. Their grade will be updated to match the new class.
          </p>
          <Select
            id="targetClassId"
            label="Target Class"
            required
            options={classOptions}
            placeholder="Select a class"
            value={targetClassId}
            onChange={(e) => setTargetClassId(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
