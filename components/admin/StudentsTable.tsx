'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

interface ClassOption {
  id: string;
  name: string;
}

interface StudentRow {
  id: string;
  admissionNumber: string;
  status: string;
  fullName: string;
  guardianName: string;
  guardianPhone: string;
  class: { id: string; name: string } | null;
}

interface Props {
  students: StudentRow[];
  classes: ClassOption[];
}

type LeaveAction = 'TRANSFER_OUT' | 'WITHDRAW' | 'GRADUATE';

const LEAVE_COPY: Record<LeaveAction, { button: string; title: string; verb: string; explain: string }> = {
  TRANSFER_OUT: { button: 'Transfer out', title: 'Transfer Students Out', verb: 'transferred out', explain: 'They leave their class now and are marked Transferred. Their history, fees and results are kept.' },
  WITHDRAW:     { button: 'Withdraw', title: 'Withdraw Students', verb: 'withdrawn', explain: 'They leave their class now and are marked Withdrawn. Their history, fees and results are kept.' },
  GRADUATE:     { button: 'Graduate', title: 'Graduate Students', verb: 'graduated', explain: 'Only Form 4 and Form 6 students can graduate. They leave their class and are marked Graduated.' },
};

const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export function StudentsTable({ students, classes }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetClassId, setTargetClassId] = useState('');
  const [leave, setLeave] = useState<LeaveAction | null>(null);
  const [reason, setReason] = useState('');
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

  async function post(url: string, body: unknown, success: (data: { data: Record<string, unknown> }) => string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Something went wrong');
        return false;
      }
      toast.success(success(data));
      setSelected(new Set());
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function handleMove() {
    if (!targetClassId) return;
    const ok = await post('/api/admin/students/move', { studentIds: Array.from(selected), classId: targetClassId },
      (d) => `Moved ${d.data.moved} student(s) to ${d.data.className}`);
    if (ok) setMoveOpen(false);
  }

  async function handleLeave() {
    if (!leave) return;
    const ok = await post('/api/admin/students/lifecycle', { action: leave, studentIds: Array.from(selected), reason: reason.trim() || undefined },
      (d) => `${d.data.count} student(s) ${LEAVE_COPY[leave].verb}`);
    if (ok) { setLeave(null); setReason(''); }
  }

  const classOptions = useMemo(
    () => classes.map((c) => ({ value: c.id, label: c.name })),
    [classes],
  );

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-rowhover px-4 py-2">
          <p className="text-sm text-ink">{selected.size} student(s) selected</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setTargetClassId(''); setMoveOpen(true); }}>
              Move to Class
            </Button>
            {(Object.keys(LEAVE_COPY) as LeaveAction[]).map((a) => (
              <Button key={a} size="sm" variant="ghost" onClick={() => { setReason(''); setLeave(a); }}>
                {LEAVE_COPY[a].button}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm text-ink">
          <thead className="border-b border-line bg-white">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all students"
                  className="h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
                />
              </th>
              {['Admission No.', 'Name', 'Guardian', 'Phone', 'Class', 'Status'].map((h, i) => (
                <th key={i} className="px-4 py-3.5 text-xs font-medium text-subtle">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {students.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleOne(s.id)}
                    aria-label={`Select ${s.fullName}`}
                    className="h-4 w-4 rounded border-line text-primary focus:ring-primary/30"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{s.admissionNumber}</td>
                <td className="px-4 py-3 font-medium">{s.fullName}</td>
                <td className="px-4 py-3">{s.guardianName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{s.guardianPhone}</td>
                <td className="px-4 py-3">{s.class?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge
                    label={statusLabel(s.status)}
                    variant={s.status === 'ACTIVE' ? 'success' : s.status === 'SUSPENDED' ? 'warning' : 'neutral'}
                  />
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                  No students found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move Students"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoveOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleMove} loading={busy} disabled={!targetClassId}>Move</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Move {selected.size} selected student(s) to a different class for the current term. Earlier terms keep the class they were in.
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

      <Modal
        open={leave !== null}
        onClose={() => setLeave(null)}
        title={leave ? LEAVE_COPY[leave].title : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLeave(null)} disabled={busy}>Cancel</Button>
            <Button variant={leave === 'GRADUATE' ? 'primary' : 'danger'} onClick={handleLeave} loading={busy}>
              {leave ? LEAVE_COPY[leave].button : ''}
            </Button>
          </>
        }
      >
        {leave && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {selected.size} student(s) will be {LEAVE_COPY[leave].verb}. {LEAVE_COPY[leave].explain}
            </p>
            <Input id="leaveReason" label="Reason (optional)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
      </Modal>
    </div>
  );
}
