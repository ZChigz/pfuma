'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/utils';
import type { AssignmentMarkStatus } from '@/types';

interface StudentRow {
  id: string;
  fullName: string;
}

interface MarkCell {
  raw: string;
  pct: number | null;
  grade: string | null;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string;
  saved: string;
}

interface Props {
  assignmentId: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  maxMark: number;
  term: string;
}

export function MarkEntryGrid({ assignmentId, classId, className, subjectId, subjectName, maxMark, term }: Props) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkCell>>({});
  const [marksStatus, setMarksStatus] = useState<AssignmentMarkStatus>('NOT_STARTED');
  const [marksVerifiedAt, setMarksVerifiedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [verifying, setVerifying] = useState(false);
  const [missingModal, setMissingModal] = useState<{ count: number; names: string[] } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/results/marks?classId=${classId}&subjectId=${subjectId}&term=${encodeURIComponent(term)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) {
          toast.error(body.message ?? 'Failed to load marks');
          return;
        }
        const { students: s, marks: m, assignment } = body.data;
        setMarksStatus(assignment.marksStatus);
        setMarksVerifiedAt(assignment.marksVerifiedAt);
        setStudents(s);

        const cells: Record<string, MarkCell> = {};
        for (const student of s as StudentRow[]) {
          const existing = (m as Array<{ studentId: string; rawMark: number; percentage: number | null; letterGrade: string | null }>).find(
            (mk) => mk.studentId === student.id,
          );
          const raw = existing != null ? String(existing.rawMark) : '';
          cells[student.id] = {
            raw,
            pct:   existing?.percentage ?? null,
            grade: existing?.letterGrade ?? null,
            status: 'idle',
            saved: raw,
          };
        }
        setMarks(cells);
      })
      .catch(() => toast.error('Failed to load marks'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLocked = marksStatus === 'VERIFIED' || marksStatus === 'PUBLISHED';
  const enteredCount = Object.values(marks).filter((c) => c.raw !== '').length;

  function isInvalid(raw: string): boolean {
    if (raw === '') return false;
    const n = parseFloat(raw);
    return isNaN(n) || n < 0 || n > maxMark;
  }

  async function handleBlur(studentId: string) {
    const cell = marks[studentId];
    if (!cell || cell.raw === cell.saved) return;

    if (isInvalid(cell.raw)) {
      setMarks((prev) => ({ ...prev, [studentId]: { ...prev[studentId], status: 'error', error: `Must be 0–${maxMark}` } }));
      return;
    }
    if (cell.raw === '') return;

    const rawNum = parseFloat(cell.raw);
    setMarks((prev) => ({ ...prev, [studentId]: { ...prev[studentId], status: 'saving' } }));

    try {
      const res = await fetch('/api/results/marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId, classId, term, rawMark: rawNum }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setMarks((prev) => ({
          ...prev,
          [studentId]: { ...prev[studentId], status: 'error', error: body.message ?? 'Failed to save' },
        }));
        return;
      }
      const saved = body.data.mark;
      setMarks((prev) => ({
        ...prev,
        [studentId]: {
          raw:    String(saved.rawMark),
          pct:    saved.percentage,
          grade:  saved.letterGrade,
          status: 'saved',
          saved:  String(saved.rawMark),
        },
      }));

      setTimeout(() => {
        setMarks((prev) => {
          if (!prev[studentId]) return prev;
          return { ...prev, [studentId]: { ...prev[studentId], status: 'idle' } };
        });
      }, 2000);
    } catch {
      setMarks((prev) => ({
        ...prev,
        [studentId]: { ...prev[studentId], status: 'error', error: 'Network error' },
      }));
    }
  }

  async function handleVerify(force = false) {
    setVerifying(true);
    try {
      const res = await fetch('/api/results/marks/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId, term, force }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.message ?? 'Failed to verify marks');
        return;
      }
      if (body.data.requiresConfirmation) {
        setMissingModal({ count: body.data.missingCount, names: body.data.missingStudents });
        return;
      }
      setMissingModal(null);
      setMarksStatus('VERIFIED');
      setMarksVerifiedAt(new Date().toISOString());
      toast.success(`Verified ${body.data.marksCount} marks`);
    } catch {
      toast.error('Network error');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/teacher/marks"
          className="mb-2 inline-block text-sm font-medium text-[#065f46] hover:underline focus:outline-none focus:ring-2 focus:ring-[#065f46]/40"
        >
          ← Back to my assignments
        </Link>
        <h1 className="text-2xl font-bold text-[#292524]">Subject: {subjectName} | Class: {className} | Max: {maxMark}</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">{term}</p>
      </div>

      {isLocked && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <p>Marks verified and submitted. Contact the Head to make changes.</p>
          {marksVerifiedAt && (
            <p className="mt-1 text-xs font-normal text-emerald-700">
              Marks were verified on {formatDateTime(marksVerifiedAt)}.
            </p>
          )}
        </div>
      )}

      {!loading && students.length > 0 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full bg-[#065f46] transition-all"
            style={{ width: `${(enteredCount / students.length) * 100}%` }}
          />
        </div>
      )}
      {!loading && students.length > 0 && (
        <p className="-mt-4 text-xs text-[#78716c]">{enteredCount} / {students.length} marks entered</p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-[#78716c]">Loading marks…</p>
      ) : students.length === 0 ? (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-10 text-center text-sm text-[#78716c]">
          No active students found for this class.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
          <table className="w-full text-left text-sm text-[#292524]">
            <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
              <tr>
                {['No.', 'Student Name', 'Mark', '%', 'Grade'].map((h) => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e7e5e4] bg-white">
              {students.map((s, idx) => {
                const cell = marks[s.id];
                const invalid = cell?.status === 'error' && isInvalid(cell.raw);
                return (
                  <tr key={s.id} className="hover:bg-[#fafaf9]">
                    <td className="w-10 px-4 py-3 text-[#78716c]">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium">{s.fullName}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={maxMark}
                          step={0.5}
                          disabled={isLocked}
                          value={cell?.raw ?? ''}
                          onChange={(e) =>
                            setMarks((prev) => ({
                              ...prev,
                              [s.id]: {
                                ...(prev[s.id] ?? { pct: null, grade: null, status: 'idle' as const, saved: '' }),
                                raw: e.target.value,
                                status: 'idle' as const,
                              },
                            }))
                          }
                          onBlur={() => handleBlur(s.id)}
                          className={`w-24 rounded-md border bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#065f46]/30 disabled:cursor-not-allowed disabled:opacity-60 ${
                            invalid ? 'border-red-500' : 'border-[#e7e5e4]'
                          }`}
                        />
                        {cell?.status === 'saving' && (
                          <svg className="h-4 w-4 animate-spin text-[#78716c]" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        )}
                        {cell?.status === 'saved' && (
                          <svg className="h-4 w-4 text-[#15803d]" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                        {cell?.status === 'error' && (
                          <span className="text-xs text-red-600" title={cell.error}>
                            ✕ {cell.error}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[#78716c]">
                      {cell?.pct != null ? `${cell.pct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {cell?.grade ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                          {cell.grade}
                        </span>
                      ) : (
                        <span className="text-[#78716c]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !isLocked && students.length > 0 && (
        <Button
          variant="primary"
          size="lg"
          loading={verifying}
          onClick={() => handleVerify(false)}
          className="w-full"
        >
          Submit and verify marks for {className} {subjectName}
        </Button>
      )}

      <Modal
        open={missingModal != null}
        onClose={() => setMissingModal(null)}
        title="Missing marks"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMissingModal(null)} disabled={verifying}>
              Go back and complete
            </Button>
            <Button variant="primary" loading={verifying} onClick={() => handleVerify(true)}>
              Submit anyway
            </Button>
          </>
        }
      >
        {missingModal && (
          <>
            <p className="text-sm text-[#292524]">
              {missingModal.count} student{missingModal.count !== 1 ? 's have' : ' has'} no mark entered. Submit anyway?
            </p>
            <ul className="mt-3 max-h-48 list-disc overflow-y-auto pl-5 text-sm text-[#78716c]">
              {missingModal.names.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </div>
  );
}
