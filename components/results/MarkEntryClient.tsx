'use client';

import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { UserRole } from '@/types';

const GRADES = [
  'ECD A', 'ECD B',
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7',
  'Form 1', 'Form 2', 'Form 3', 'Form 4', 'Form 5', 'Form 6',
];

interface SubjectOption {
  id:   string;
  name: string;
  code: string;
  grade: string;
  maxMark: number;
  assignments: Array<{ teacherId: string; term: string }>;
}

interface StudentOption {
  id:       string;
  fullName: string;
}

interface MarkState {
  rawMark:     string;
  letterGrade: string | null;
  saving:      boolean;
}

interface Props {
  role:   UserRole;
  userId: string;
}

export function MarkEntryClient({ role, userId }: Props) {
  const toast = useToast();

  const [grade,     setGrade]     = useState('');
  const [term,      setTerm]      = useState('');
  const [subjectId, setSubjectId] = useState('');

  const [subjects,  setSubjects]  = useState<SubjectOption[]>([]);
  const [students,  setStudents]  = useState<StudentOption[]>([]);
  const [marks,     setMarks]     = useState<Record<string, MarkState>>({});
  const [published, setPublished] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [maxMark,   setMaxMark]   = useState(100);

  // Committed term — only triggers data load when user steps away from input
  const [committedTerm, setCommittedTerm] = useState('');
  const termRef = useRef<HTMLInputElement>(null);

  // Reset and fetch subjects when grade changes
  useEffect(() => {
    setSubjectId('');
    setSubjects([]);
    setStudents([]);
    setMarks({});
    setPublished(false);
    if (!grade) return;

    fetch(`/api/results/subjects?grade=${encodeURIComponent(grade)}`)
      .then((r) => r.json())
      .then((d) => setSubjects(d.data?.subjects ?? []))
      .catch(() => toast.error('Failed to load subjects'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade]);

  // Load students + marks when all three selectors are ready
  useEffect(() => {
    if (!grade || !committedTerm || !subjectId) return;
    setLoading(true);
    setMarks({});
    setStudents([]);

    Promise.all([
      fetch(`/api/accounting/students?grade=${encodeURIComponent(grade)}`).then((r) => r.json()),
      fetch(`/api/results/marks?subjectId=${subjectId}&term=${encodeURIComponent(committedTerm)}`).then((r) => r.json()),
    ])
      .then(([sData, mData]) => {
        setStudents(sData.data?.students ?? []);

        const existing: Record<string, MarkState> = {};
        for (const m of mData.data?.marks ?? []) {
          existing[m.studentId] = {
            rawMark:     m.rawMark != null ? String(m.rawMark) : '',
            letterGrade: m.letterGrade ?? null,
            saving:      false,
          };
        }
        setMarks(existing);
        setPublished(mData.data?.published ?? false);

        const sub = subjects.find((s) => s.id === subjectId);
        if (sub) setMaxMark(sub.maxMark);
      })
      .catch(() => toast.error('Failed to load marks'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, committedTerm, subjectId]);

  async function saveMark(studentId: string) {
    const raw = marks[studentId]?.rawMark ?? '';
    const rawNum = parseFloat(raw);
    if (raw === '' || isNaN(rawNum)) return;

    setMarks((prev) => ({
      ...prev,
      [studentId]: { ...(prev[studentId] ?? { letterGrade: null, rawMark: raw }), saving: true },
    }));

    try {
      const res = await fetch('/api/results/marks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ studentId, subjectId, term: committedTerm, rawMark: rawNum }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to save mark');
        setMarks((prev) => ({ ...prev, [studentId]: { ...prev[studentId], saving: false } }));
        return;
      }
      setMarks((prev) => ({
        ...prev,
        [studentId]: {
          rawMark:     String(data.data.mark.rawMark),
          letterGrade: data.data.mark.letterGrade ?? null,
          saving:      false,
        },
      }));
    } catch {
      toast.error('Network error saving mark');
      setMarks((prev) => ({ ...prev, [studentId]: { ...prev[studentId], saving: false } }));
    }
  }

  // For TEACHERs: only show subjects they're assigned to for the selected term
  const visibleSubjects =
    role === 'TEACHER'
      ? subjects.filter((s) =>
          s.assignments.some((a) => a.teacherId === userId && a.term === committedTerm),
        )
      : subjects;

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const canEnter = !published;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#292524]">Mark Entry</h1>
        <p className="mt-0.5 text-sm text-[#78716c]">Enter and save student marks per subject</p>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap gap-3">
        {/* Grade */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Grade</label>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
          >
            <option value="">— Select grade —</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* Term */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Term</label>
          <input
            ref={termRef}
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onBlur={() => setCommittedTerm(term.trim())}
            placeholder="e.g. Term 1 2025"
            className="min-h-[44px] w-44 rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
          />
        </div>

        {/* Subject */}
        {grade && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-[#78716c]">Subject</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 text-sm text-[#292524] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30"
            >
              <option value="">— Select subject —</option>
              {(committedTerm ? visibleSubjects : subjects).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code}) — max {s.maxMark}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Published banner */}
      {published && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Results for this term have been published and are locked. Marks cannot be edited.
        </div>
      )}

      {/* Mark entry grid */}
      {subjectId && committedTerm && !loading && (
        <>
          {students.length === 0 ? (
            <p className="rounded-xl border border-[#e7e5e4] bg-white px-4 py-10 text-center text-sm text-[#78716c]">
              No active students found for {grade}.
            </p>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#292524]">
                  {selectedSubject?.name} — {committedTerm}
                  <span className="ml-2 font-normal text-[#78716c]">(max {maxMark})</span>
                </h2>
                <span className="text-xs text-[#78716c]">{students.length} students</span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#e7e5e4]">
                <table className="w-full text-left text-sm text-[#292524]">
                  <thead className="border-b border-[#e7e5e4] bg-[#f5f5f4]">
                    <tr>
                      {['#', 'Student', `Mark / ${maxMark}`, 'Letter Grade'].map((h, i) => (
                        <th key={i} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#78716c]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e7e5e4] bg-white">
                    {students.map((s, idx) => {
                      const ms    = marks[s.id];
                      const grade_ = ms?.letterGrade;
                      return (
                        <tr key={s.id}>
                          <td className="w-10 px-4 py-3 text-[#78716c]">{idx + 1}</td>
                          <td className="px-4 py-3 font-medium">{s.fullName}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                max={maxMark}
                                step={0.5}
                                value={ms?.rawMark ?? ''}
                                disabled={!canEnter}
                                onChange={(e) =>
                                  setMarks((prev) => ({
                                    ...prev,
                                    [s.id]: {
                                      rawMark:     e.target.value,
                                      letterGrade: prev[s.id]?.letterGrade ?? null,
                                      saving:      false,
                                    },
                                  }))
                                }
                                onBlur={() => saveMark(s.id)}
                                className="w-24 rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#065f46]/30 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              {ms?.saving && (
                                <span className="text-xs text-[#78716c]">saving…</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {grade_ ? (
                              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                                {grade_}
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
          )}
        </>
      )}

      {loading && (
        <p className="py-8 text-center text-sm text-[#78716c]">Loading…</p>
      )}

      {!subjectId && grade && (
        <p className="text-sm text-[#78716c]">Select a subject and enter a term to start entering marks.</p>
      )}

      {!grade && (
        <p className="text-sm text-[#78716c]">Select a grade to get started.</p>
      )}
    </div>
  );
}
