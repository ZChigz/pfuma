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
  termId: string;
  termName: string;
}

export function MarkEntryGrid({ assignmentId, classId, className, subjectId, subjectName, maxMark, termId, termName }: Props) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkCell>>({});
  const [marksStatus, setMarksStatus] = useState<AssignmentMarkStatus>('NOT_STARTED');
  const [marksVerifiedAt, setMarksVerifiedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [verifying, setVerifying] = useState(false);
  const [missingModal, setMissingModal] = useState<{ count: number; names: string[] } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/results/marks?classId=${classId}&subjectId=${subjectId}&termId=${termId}`)
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
        body: JSON.stringify({ studentId, subjectId, classId, termId, rawMark: rawNum }),
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
        body: JSON.stringify({ assignmentId, force }),
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
          className="mb-2 inline-block text-sm font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          ← Back to my assignments
        </Link>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">Subject: {subjectName} | Class: {className} | Max: {maxMark}</h1>
        <p className="mt-1 text-sm text-muted">{termName}</p>
      </div>

      {isLocked && (
        <div className="rounded-xl border border-transparent bg-success-bg px-4 py-3 text-sm font-medium text-primary">
          <p>Marks verified and submitted. Contact the Head to make changes.</p>
          {marksVerifiedAt && (
            <p className="mt-1 text-xs font-normal text-primary">
              Marks were verified on {formatDateTime(marksVerifiedAt)}.
            </p>
          )}
        </div>
      )}

      {!loading && students.length > 0 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-tint">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(enteredCount / students.length) * 100}%` }}
          />
        </div>
      )}
      {!loading && students.length > 0 && (
        <p className="-mt-4 text-xs text-muted">{enteredCount} / {students.length} marks entered</p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading marks…</p>
      ) : students.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-muted">
          No active students found for this class.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white">
          <table className="w-full text-left text-sm text-ink">
            <thead className="border-b border-line bg-white">
              <tr>
                {['No.', 'Student Name', 'Mark', '%', 'Grade'].map((h) => (
                  <th key={h} className="px-4 py-3.5 text-xs font-medium text-subtle">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {students.map((s, idx) => {
                const cell = marks[s.id];
                const invalid = cell?.status === 'error' && isInvalid(cell.raw);
                return (
                  <tr key={s.id} className="hover:bg-rowhover">
                    <td className="w-10 px-4 py-3 text-muted">{idx + 1}</td>
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
                          className={`w-24 rounded-xl border bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 ${
                            invalid ? 'border-danger' : 'border-line'
                          }`}
                        />
                        {cell?.status === 'saving' && (
                          <svg className="h-4 w-4 animate-spin text-muted" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                        )}
                        {cell?.status === 'saved' && (
                          <svg className="h-4 w-4 text-success" viewBox="0 0 20 20" fill="currentColor">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                        {cell?.status === 'error' && (
                          <span className="text-xs text-danger" title={cell.error}>
                            ✕ {cell.error}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">
                      {cell?.pct != null ? `${cell.pct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {cell?.grade ? (
                        <span className="inline-flex items-center rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-primary">
                          {cell.grade}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
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
            <p className="text-sm text-ink">
              {missingModal.count} student{missingModal.count !== 1 ? 's have' : ' has'} no mark entered. Submit anyway?
            </p>
            <ul className="mt-3 max-h-48 list-disc overflow-y-auto pl-5 text-sm text-muted">
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
