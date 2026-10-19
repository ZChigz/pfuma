'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Dot, linkButton, Notice, Section, Tabs, Td, Th } from '@/components/academics/shared';
import { WeekGrid, type GridDayData, type GridSlot } from '@/components/academics/WeekGrid';

type Tab = 'students' | 'subjects' | 'timetable' | 'attendance';

interface Student { n: number; id: string; admissionNumber: string; fullName: string; surname: string; firstName: string; gender: string | null; boarding: string; status: string }
interface SubjectRow {
  subjectId: string; subject: string; shortName: string; colour: string; type: 'CORE' | 'ELECTIVE'; teacher: string | null; initials: string | null; coTeacher: string | null;
  periodsPerWeek: number | null; via: 'CLASS' | 'GROUP' | null; groupName: string | null; students: number; uncovered: number; gap: boolean;
}
interface Week { days: GridDayData[]; cells: Record<string, GridSlot[]>; timetable: { version: number; status: string; effectiveFrom: string | null } | null }
interface Attendance { registersMarked: number; classRate: number | null; students: { id: string; fullName: string; present: number; late: number; absent: number; excused: number; rate: number | null }[] }

export function ClassDetailClient({ classId, students, subjects, gaps, week, attendance, threshold, canPrint }: {
  classId: string; students: Student[]; subjects: SubjectRow[]; gaps: string[]; week: Week | null; attendance: Attendance | null; threshold: number; canPrint: boolean;
}) {
  const [tab, setTab] = useState<Tab>('students');
  const tabs = [
    { id: 'students' as const, label: 'Students', badge: students.length },
    { id: 'subjects' as const, label: 'Subjects and teachers', badge: gaps.length ? `${gaps.length} gap${gaps.length === 1 ? '' : 's'}` : undefined },
    ...(week ? [{ id: 'timetable' as const, label: 'Timetable' }] : []),
    ...(attendance ? [{ id: 'attendance' as const, label: 'Attendance' }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Tabs label="Class sections" tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'students' && (
        <Section
          title="Class list"
          hint="From this term's enrolment, in order of surname."
          action={canPrint && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/print/academics/class-list?classId=${classId}`} target="_blank" className={linkButton}>Print (A4)</Link>
              <a href={`/api/academics/classes/${classId}/students?format=csv`} className={linkButton}>Export CSV</a>
            </div>
          )}
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <caption className="sr-only">Students in the class</caption>
              <thead><tr><Th>No</Th><Th>Name</Th><Th>Admission no.</Th><Th>Gender</Th><Th>Boarding</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {students.length === 0 && <tr><Td className="text-muted">No students are enrolled in this class this term.</Td></tr>}
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-rowhover">
                    <Td className="tabular-nums text-muted">{s.n}</Td>
                    <Td><span className="font-semibold uppercase">{s.surname}</span>, {s.firstName}</Td>
                    <Td className="text-muted">{s.admissionNumber}</Td>
                    <Td>{s.gender === 'M' ? 'Boy' : s.gender === 'F' ? 'Girl' : '—'}</Td>
                    <Td>{s.boarding === 'BOARDER' ? 'Boarder' : 'Day'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === 'subjects' && (
        <Section title="Subjects and teachers" hint="Every subject taught in the class, and who teaches it.">
          {gaps.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">{gaps.map((g) => <Notice key={g} tone="warn">{g}</Notice>)}</div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <caption className="sr-only">Subjects and teachers</caption>
              <thead><tr><Th>Subject</Th><Th>Type</Th><Th>Teacher</Th><Th className="text-right">Periods</Th><Th className="text-right">Students</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {subjects.map((s) => (
                  <tr key={s.subjectId} className={s.gap ? 'bg-warn-bg/60' : 'hover:bg-rowhover'}>
                    <Td><span className="flex items-center gap-2 font-semibold"><Dot colour={s.colour} />{s.subject}</span></Td>
                    <Td><Badge variant={s.type === 'CORE' ? 'info' : 'neutral'} label={s.type === 'CORE' ? 'Core' : 'Elective'} /></Td>
                    <Td>
                      {s.teacher ? (
                        <>{s.teacher}{s.coTeacher && <span className="text-muted"> + {s.coTeacher}</span>}{s.groupName && <span className="block text-xs text-muted">Group: {s.groupName}</span>}</>
                      ) : <span className="font-semibold text-danger">No teacher</span>}
                      {s.gap && s.teacher && <span className="block text-xs text-warn">{s.uncovered} of {s.students} students have no teacher</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{s.periodsPerWeek ?? '—'}</Td>
                    <Td className="text-right tabular-nums">{s.students}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === 'timetable' && week && (
        <Section title="Timetable" hint={week.timetable ? `Version ${week.timetable.version}, in force from ${week.timetable.effectiveFrom}.` : 'No timetable has been published for this term yet.'}
          action={week.timetable && <Link href={`/print/academics/timetable?view=class&id=${classId}`} target="_blank" className={linkButton}>Print (A4)</Link>}>
          {week.timetable ? <WeekGrid days={week.days} cells={week.cells} view="class" dense /> : <p className="text-sm text-muted">Once the Deputy publishes the timetable, this class&apos;s week appears here.</p>}
        </Section>
      )}

      {tab === 'attendance' && attendance && (
        <Section title="Register summary" hint={`${attendance.registersMarked} morning registers this term. Class attendance ${attendance.classRate === null ? '—' : `${attendance.classRate}%`}.`}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <caption className="sr-only">Attendance of each student this term</caption>
              <thead><tr><Th>Student</Th><Th className="text-right">Present</Th><Th className="text-right">Late</Th><Th className="text-right">Absent</Th><Th className="text-right">Excused</Th><Th className="text-right">Rate</Th></tr></thead>
              <tbody className="divide-y divide-line">
                {attendance.students.map((s) => (
                  <tr key={s.id} className="hover:bg-rowhover">
                    <Td className="font-semibold">{s.fullName}</Td>
                    <Td className="text-right tabular-nums">{s.present}</Td><Td className="text-right tabular-nums">{s.late}</Td>
                    <Td className="text-right tabular-nums">{s.absent}</Td><Td className="text-right tabular-nums">{s.excused}</Td>
                    <Td className="text-right">{s.rate === null ? '—' : <span className={s.rate < threshold ? 'font-semibold text-danger' : ''}>{s.rate}%</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
