'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Row {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  classId: string;
  className: string;
  levelOrder: number;
  decision: 'ACTIVE' | 'PROMOTED' | 'REPEATED' | 'TRANSFERRED_OUT' | 'WITHDRAWN' | 'GRADUATED';
  studentStatus: string;
}

interface Props {
  sourceTerm: { id: string; name: string };
  sourceTerms: { id: string; name: string }[];
  targetTermName: string | null;
  nextYear: number;
  rows: Row[];
}

type Action = 'PROMOTE' | 'REPEAT' | 'GRADUATE' | 'WITHDRAW';

const DECISION_LABEL: Record<Row['decision'], { label: string; variant: 'neutral' | 'success' | 'warning' | 'info' | 'danger' }> = {
  ACTIVE:          { label: 'No decision yet', variant: 'warning' },
  PROMOTED:        { label: 'Promoted', variant: 'success' },
  REPEATED:        { label: 'Repeating', variant: 'info' },
  GRADUATED:       { label: 'Graduated', variant: 'success' },
  TRANSFERRED_OUT: { label: 'Transferred out', variant: 'neutral' },
  WITHDRAWN:       { label: 'Withdrawn', variant: 'neutral' },
};

export function PromotionsClient({ sourceTerm, sourceTerms, targetTermName, nextYear, rows }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Action | null>(null);

  const undecided = rows.filter((r) => r.decision === 'ACTIVE');
  const byClass = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.className, [...(m.get(r.className) ?? []), r]);
    return Array.from(m);
  }, [rows]);

  const selectedRows = rows.filter((r) => selected.has(r.studentId));
  const canPromote = selectedRows.length > 0 && selectedRows.every((r) => r.levelOrder < 6);
  const canGraduate = selectedRows.length > 0 && selectedRows.every((r) => r.levelOrder === 4 || r.levelOrder === 6);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleClass(classRows: Row[]) {
    const ids = classRows.filter((r) => r.decision === 'ACTIVE').map((r) => r.studentId);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) if (allOn) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function run(action: Action) {
    setBusy(action);
    try {
      const res = await fetch('/api/admin/students/lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          studentIds: Array.from(selected),
          ...(action === 'PROMOTE' || action === 'REPEAT' ? { sourceTermId: sourceTerm.id } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Something went wrong');
        return;
      }
      toast.success(`${data.data.count} student(s) updated`);
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4">
        <div className="text-sm text-ink">
          <p>
            From <span className="font-semibold">{sourceTerm.name}</span> to{' '}
            <span className="font-semibold">{targetTermName ?? `${nextYear} (not created yet)`}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">{undecided.length} of {rows.length} student(s) still need a decision.</p>
        </div>
        {sourceTerms.length > 1 && (
          <select
            defaultValue={sourceTerm.id}
            onChange={(e) => router.push(`/admin/promotions?termId=${e.target.value}`)}
            className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm text-ink"
            aria-label="Term to promote from"
          >
            {sourceTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {!targetTermName && (
        <p className="rounded-xl border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn">
          Create the {nextYear} academic year on the{' '}
          <Link href="/admin/academic" className="font-medium underline">Academic calendar</Link> before promoting or keeping students back.
        </p>
      )}

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-rowhover px-4 py-2">
          <p className="text-sm text-ink">{selected.size} selected</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run('PROMOTE')} loading={busy === 'PROMOTE'} disabled={!canPromote || !targetTermName || !!busy}
              title={!canPromote ? 'Form 6 students graduate instead' : undefined}>
              Promote to next level
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run('REPEAT')} loading={busy === 'REPEAT'} disabled={!targetTermName || !!busy}>
              Repeat level
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run('GRADUATE')} loading={busy === 'GRADUATE'} disabled={!canGraduate || !!busy}
              title={!canGraduate ? 'Only Form 4 and Form 6 students can graduate' : undefined}>
              Graduate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run('WITHDRAW')} loading={busy === 'WITHDRAW'} disabled={!!busy}>
              Withdraw
            </Button>
          </div>
        </div>
      )}

      {byClass.map(([className, classRows]) => (
        <section key={className} className="rounded-2xl bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{className}</h2>
            {classRows.some((r) => r.decision === 'ACTIVE') && (
              <button type="button" onClick={() => toggleClass(classRows)} className="text-xs font-medium text-primary hover:underline">
                Select all undecided
              </button>
            )}
          </div>
          <ul className="divide-y divide-line">
            {classRows.map((r) => (
              <li key={r.studentId} className="flex items-center gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(r.studentId)}
                  onChange={() => toggle(r.studentId)}
                  disabled={r.decision !== 'ACTIVE'}
                  aria-label={`Select ${r.fullName}`}
                  className="h-4 w-4 rounded border-line text-primary focus:ring-primary/30 disabled:opacity-40"
                />
                <span className="w-28 font-mono text-xs text-muted">{r.admissionNumber}</span>
                <span className="flex-1 text-ink">{r.fullName}</span>
                <Badge label={DECISION_LABEL[r.decision].label} variant={DECISION_LABEL[r.decision].variant} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
