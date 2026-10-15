'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export interface DetailRow {
  studentId: string;
  fullName: string;
  classTeacherRemark: string;
  headRemark: string;
  daysPresent: string;
  daysAbsent: string;
}

// Report-card extras per student: remarks, days present / absent. The Head can edit all;
// the class teacher's own remark and the days can also be saved by the class teacher
// through the same API.
export function ReportCardDetails({ termId, rows }: { termId: string; rows: DetailRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState(rows);
  const [saving, setSaving] = useState<string | null>(null);

  const set = (id: string, patch: Partial<DetailRow>) =>
    setValues((prev) => prev.map((r) => (r.studentId === id ? { ...r, ...patch } : r)));

  async function save(r: DetailRow) {
    setSaving(r.studentId);
    try {
      const res = await fetch('/api/results/remarks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: r.studentId,
          termId,
          classTeacherRemark: r.classTeacherRemark,
          headRemark: r.headRemark,
          daysPresent: r.daysPresent === '' ? null : Number(r.daysPresent),
          daysAbsent: r.daysAbsent === '' ? null : Number(r.daysAbsent),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.message ?? 'Could not save'); return; }
      toast.success(`Saved ${r.fullName}`);
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  const input = 'rounded-xl border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-ink">Report card details</h2>
      <div className="overflow-x-auto rounded-2xl bg-white">
        <table className="w-full text-left text-sm text-ink">
          <thead className="border-b border-line">
            <tr>
              {['Student', 'Class teacher remark', 'Head remark', 'Days present', 'Days absent', ''].map((h) => (
                <th key={h} className="px-3 py-3 text-xs font-medium text-subtle">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {values.map((r) => (
              <tr key={r.studentId}>
                <td className="px-3 py-2 font-medium">{r.fullName}</td>
                <td className="px-3 py-2"><input aria-label={`Class teacher remark for ${r.fullName}`} className={`${input} w-56`} maxLength={500} value={r.classTeacherRemark} onChange={(e) => set(r.studentId, { classTeacherRemark: e.target.value })} /></td>
                <td className="px-3 py-2"><input aria-label={`Head remark for ${r.fullName}`} className={`${input} w-56`} maxLength={500} value={r.headRemark} onChange={(e) => set(r.studentId, { headRemark: e.target.value })} /></td>
                <td className="px-3 py-2"><input aria-label={`Days present for ${r.fullName}`} type="number" min={0} max={366} className={`${input} w-20`} value={r.daysPresent} onChange={(e) => set(r.studentId, { daysPresent: e.target.value })} /></td>
                <td className="px-3 py-2"><input aria-label={`Days absent for ${r.fullName}`} type="number" min={0} max={366} className={`${input} w-20`} value={r.daysAbsent} onChange={(e) => set(r.studentId, { daysAbsent: e.target.value })} /></td>
                <td className="px-3 py-2"><Button size="sm" variant="secondary" onClick={() => save(r)} loading={saving === r.studentId}>Save</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
