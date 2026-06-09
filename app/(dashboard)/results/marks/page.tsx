'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from '@/components/ui/Toast';
import type { UserRole } from '@/types';

const TERMS = ['Term 1, 2026', 'Term 2, 2026', 'Term 3, 2026'];

interface SubjectOption {
  id: string;
  name: string;
  code: string;
  grade: string;
  maxMark: number;
}

interface Assignment {
  subjectId: string;
  term: string;
  subject: SubjectOption;
}

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

export default function MarksPage() {
  const { data: session, status: sessionStatus } = useSession();
  const role = session?.user?.role as UserRole | undefined;
  const userId = session?.user?.id;

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('');

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marks, setMarks] = useState<Record<string, MarkCell>>({});
  const [maxMark, setMaxMark] = useState(100);
  const [subjectName, setSubjectName] = useState('');
  const [isPublished, setIsPublished] = useState(false);
  const [loadingMarks, setLoadingMarks] = useState(false);

  // Fetch assignments once authenticated
  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    fetch('/api/results/assignments?teacherId=me')
      .then((r) => r.json())
      .then((body) => {
        if (body.success) setAssignments(body.data.assignments);
        else toast.error(body.message ?? 'Failed to load assignments');
      })
      .catch(() => toast.error('Failed to load assignments'));
  }, [sessionStatus, userId]);

  // Unique subjects for the dropdown, optionally filtered by selected term
  const uniqueMap = new Map<string, SubjectOption>();
  for (const a of assignments) {
    if (!uniqueMap.has(a.subjectId)) uniqueMap.set(a.subjectId, a.subject);
  }
  const subjectsForTerm = selectedTerm
    ? Array.from(uniqueMap.values()).filter((s) =>
        assignments.some((a) => a.subjectId === s.id && a.term === selectedTerm),
      )
    : Array.from(uniqueMap.values());

  // Load marks when subject + term are both selected
  useEffect(() => {
    if (!selectedSubjectId || !selectedTerm) {
      setStudents([]);
      setMarks({});
      return;
    }
    setLoadingMarks(true);
    setMarks({});
    setStudents([]);

    fetch(
      `/api/results/marks?subjectId=${selectedSubjectId}&term=${encodeURIComponent(selectedTerm)}`,
    )
      .then((r) => r.json())
      .then((body) => {
        if (!body.success) {
          toast.error(body.message ?? 'Failed to load marks');
          return;
        }
        const { subject, students: s, marks: m, isPublished: p } = body.data;
        setMaxMark(subject.maxMark);
        setSubjectName(subject.name);
        setIsPublished(p);
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
      .finally(() => setLoadingMarks(false));
  }, [selectedSubjectId, selectedTerm]);

  async function handleBlur(studentId: string) {
    const cell = marks[studentId];
    if (!cell || cell.raw === cell.saved) return;
    const rawNum = parseFloat(cell.raw);
    if (cell.raw === '' || isNaN(rawNum)) return;

    setMarks((prev) => ({ ...prev, [studentId]: { ...prev[studentId], status: 'saving' } }));

    try {
      const res = await fetch('/api/results/marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          subjectId: selectedSubjectId,
          term:      selectedTerm,
          rawMark:   rawNum,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setMarks((prev) => ({
          ...prev,
          [studentId]: {
            ...prev[studentId],
            status: 'error',
            error: body.message ?? 'Failed to save',
          },
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

  if (sessionStatus === 'loading') {
    return <p className="py-12 text-center text-sm text-[#78716c]">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Mark Entry</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Enter student marks per subject and term</p>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Term</label>
          <select
            value={selectedTerm}
            onChange={(e) => {
              setSelectedTerm(e.target.value);
              setSelectedSubjectId('');
            }}
            className="min-h-[44px] min-w-[180px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
          >
            <option value="">— Select term —</option>
            {TERMS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Subject</label>
          <select
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            disabled={!selectedTerm}
            className="min-h-[44px] min-w-[240px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">— Select subject —</option>
            {subjectsForTerm.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code}) &mdash; {s.grade}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* No assignments */}
      {sessionStatus === 'authenticated' && assignments.length === 0 && (
        <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-10 text-center text-sm text-[#78716c]">
          {role === 'TEACHER'
            ? 'No subjects are assigned to you. Ask your head of department.'
            : 'No subject assignments found.'}
        </p>
      )}

      {/* Published banner */}
      {isPublished && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Published — locked. Results for this term have been published and cannot be edited.
        </div>
      )}

      {/* Loading marks */}
      {loadingMarks && (
        <p className="py-8 text-center text-sm text-[#78716c]">Loading marks…</p>
      )}

      {/* Mark grid */}
      {!loadingMarks && selectedSubjectId && selectedTerm && (
        students.length === 0 ? (
          <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-10 text-center text-sm text-[#78716c]">
            No active students found for this subject&rsquo;s grade.
          </p>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#292524]">
                {subjectName} &mdash; {selectedTerm}
                <span className="ml-2 font-normal text-[#78716c]">(out of {maxMark})</span>
              </h2>
              <span className="text-xs text-[#78716c]">{students.length} student{students.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
              <table className="w-full text-left text-sm text-[#292524]">
                <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                  <tr>
                    {['#', 'Student Name', `Mark / ${maxMark}`, '%', 'Grade'].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e7e5e4] bg-white">
                  {students.map((s, idx) => {
                    const cell = marks[s.id];
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
                              disabled={isPublished}
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
                              className="w-24 rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#065f46]/30 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            {cell?.status === 'saving' && (
                              <svg
                                className="h-4 w-4 animate-spin text-[#78716c]"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v8z"
                                />
                              </svg>
                            )}
                            {cell?.status === 'saved' && (
                              <svg
                                className="h-4 w-4 text-[#15803d]"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                            {cell?.status === 'error' && (
                              <span
                                className="text-xs text-red-600"
                                title={cell.error}
                              >
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
          </div>
        )
      )}

      {!loadingMarks && !selectedSubjectId && assignments.length > 0 && (
        <p className="text-sm text-[#78716c]">Select a term and subject above to start entering marks.</p>
      )}
    </div>
  );
}
