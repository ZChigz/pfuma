// Alumni: students who completed O Level or A Level become alumni automatically (when the leaving is finished or
// the year-end promotion is confirmed); others can be added by hand. Each record keeps the year left, the last class,
// a current phone and email that can be updated later, and what they went on to. The list can be exported for
// reunion or fundraising contact lists; every export is audit-logged.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { toCsv, type CsvCell } from '@/lib/csv';
import { getScopedDb } from '@/lib/scoped-db';
import { idSchema, noteSchema } from '@/lib/students/common';
import { mobilePhone, optionalText } from '@/lib/students/registration';

export const ALUMNI_PAGE_SIZE = 50;

export const AlumniQuerySchema = z.object({
  q: z.string().trim().max(100).optional().transform((v) => v ?? ''),
  year: z.coerce.number().int().min(1950).max(2200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

function where(f: { q: string; year?: number }): Prisma.AlumnusWhereInput {
  const and: Prisma.AlumnusWhereInput[] = [];
  if (f.year) and.push({ yearLeft: f.year });
  const q = f.q.trim();
  if (q.length >= 2) {
    and.push({
      OR: [
        { student: { fullName: { contains: q, mode: 'insensitive' } } },
        { student: { admissionNumber: { contains: q, mode: 'insensitive' } } },
        { destination: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

export interface AlumnusRow {
  id: string;
  studentId: string;
  fullName: string;
  admissionNumber: string;
  yearLeft: number;
  lastClass: string | null;
  phone: string | null;
  email: string | null;
  destination: string | null;
  /** Latest published result, when Exams is on. */
  finalResult: { term: string; percentage: number; grade: string | null } | null;
  /** The latest released board results (ZIMSEC or Cambridge), when there are any: "ZIMSEC November 2026: 7 grades". */
  boardSummary: string | null;
}

export async function listAlumni(user: AccessUser, rawFilters: z.input<typeof AlumniQuerySchema>) {
  const f = AlumniQuerySchema.parse(rawFilters);
  const db = getScopedDb(user.schoolId, user.id);
  const filter = where(f);
  const [total, rows, years, off] = await Promise.all([
    db.alumnus.count({ where: filter }),
    db.alumnus.findMany({
      where: filter, orderBy: [{ yearLeft: 'desc' }, { student: { surname: 'asc' } }, { student: { firstName: 'asc' } }],
      skip: (f.page - 1) * ALUMNI_PAGE_SIZE, take: ALUMNI_PAGE_SIZE, include: { student: { select: { id: true, fullName: true, admissionNumber: true } } },
    }),
    db.alumnus.findMany({ distinct: ['yearLeft'], select: { yearLeft: true }, orderBy: { yearLeft: 'desc' } }),
    db.schoolModule.findFirst({ where: { module: 'exams', enabled: false } }),
  ]);
  const results = off || rows.length === 0
    ? []
    : await db.termResult.findMany({ where: { studentId: { in: rows.map((r) => r.studentId) }, published: true }, orderBy: { term: { startDate: 'desc' } }, include: { term: { select: { name: true } } } });
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) if (!latest.has(r.studentId)) latest.set(r.studentId, r);
  // Released board results attach to the alumni record through the student.
  const board = off || rows.length === 0
    ? []
    : await db.boardResult.findMany({ where: { studentId: { in: rows.map((r) => r.studentId) } }, select: { studentId: true, sessionId: true, session: { select: { board: true, session: true, createdAt: true } } }, orderBy: { session: { createdAt: 'desc' } } });
  const boardOf = new Map<string, { label: string; sessionId: string; n: number }>();
  for (const b of board) {
    const cur = boardOf.get(b.studentId!);
    if (!cur) boardOf.set(b.studentId!, { label: `${b.session.board} ${b.session.session}`, sessionId: b.sessionId, n: 1 });
    else if (cur.sessionId === b.sessionId) cur.n++;
  }
  return {
    total, years: years.map((y) => y.yearLeft), pageSize: ALUMNI_PAGE_SIZE,
    rows: rows.map<AlumnusRow>((a) => {
      const r = latest.get(a.studentId);
      return {
        id: a.id, studentId: a.studentId, fullName: a.student.fullName, admissionNumber: a.student.admissionNumber, yearLeft: a.yearLeft, lastClass: a.lastClass,
        phone: a.phone, email: a.email, destination: a.destination,
        finalResult: r ? { term: r.term.name, percentage: r.percentage.toNumber(), grade: r.letterGrade } : null,
        boardSummary: boardOf.has(a.studentId) ? `${boardOf.get(a.studentId)!.label}: ${boardOf.get(a.studentId)!.n} grade${boardOf.get(a.studentId)!.n === 1 ? '' : 's'}` : null,
      };
    }),
  };
}

export const AlumnusSchema = z.object({
  yearLeft: z.number().int().min(1950).max(2200).optional(),
  lastClass: optionalText('Last class', 60).optional(),
  phone: z.string().optional().transform((v, ctx) => {
    if (!v?.trim()) return null;
    const p = mobilePhone('Phone', true).safeParse(v);
    if (!p.success) { ctx.addIssue({ code: 'custom', message: 'Enter a Zimbabwean mobile number such as 0771234567' }); return null; }
    return p.data;
  }),
  email: optionalText('Email', 100, { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Email must look like name@example.com' }),
  destination: noteSchema(200),
});

/** Update the contact details and what they went on to (further study, work). */
export async function updateAlumnus(user: AccessUser, alumnusId: string, rawInput: z.input<typeof AlumnusSchema>) {
  const input = AlumnusSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const a = await tx.alumnus.findFirst({ where: { id: alumnusId, schoolId }, include: { student: { select: { fullName: true } } } });
    if (!a) throw new ServiceError('Alumni record not found', 404);
    const data: Prisma.AlumnusUncheckedUpdateInput = {};
    if (input.yearLeft !== undefined) data.yearLeft = input.yearLeft;
    if (input.lastClass !== undefined) data.lastClass = input.lastClass;
    data.phone = input.phone;
    data.email = input.email?.toLowerCase() ?? null;
    data.destination = input.destination ?? null;
    await tx.alumnus.update({ where: { id: alumnusId }, data });
    await logAudit({ schoolId, actorId: user.id, action: 'UPDATE_ALUMNUS', entityType: 'Alumnus', entityId: alumnusId, detail: `${a.student.fullName}: alumni record changed`, after: { changed: Object.keys(data) } }, tx);
    return { updated: true };
  });
}

export const AddAlumnusSchema = z.object({ studentId: idSchema, yearLeft: z.number().int().min(1950).max(2200), lastClass: noteSchema(60), destination: noteSchema(200) });

/** Adds a former student who did not complete O or A Level (they left earlier) to the alumni by hand. */
export async function addAlumnus(user: AccessUser, rawInput: z.input<typeof AddAlumnusSchema>) {
  const input = AddAlumnusSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { id: input.studentId, schoolId }, select: { id: true, fullName: true, status: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    if (s.status === 'ACTIVE' || s.status === 'SUSPENDED') throw new ServiceError(`${s.fullName} is still at the school`, 409);
    if (s.status === 'DECEASED') throw new ServiceError('A student who has died cannot be added to the alumni contact list', 409);
    if (await tx.alumnus.findFirst({ where: { studentId: s.id } })) throw new ServiceError(`${s.fullName} is already in the alumni`, 409);
    const a = await tx.alumnus.create({ data: { schoolId, studentId: s.id, yearLeft: input.yearLeft, lastClass: input.lastClass ?? null, destination: input.destination ?? null } });
    await logAudit({ schoolId, actorId: user.id, action: 'UPDATE_ALUMNUS', entityType: 'Alumnus', entityId: a.id, detail: `${s.fullName}: added to the alumni by hand`, after: { yearLeft: input.yearLeft } }, tx);
    return a;
  });
}

/** CSV for reunion or fundraising contact lists. Every export is audit-logged with the filters and the number of people. */
export async function exportAlumni(user: AccessUser, rawFilters: z.input<typeof AlumniQuerySchema>) {
  const f = AlumniQuerySchema.parse(rawFilters);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.alumnus.findMany({
      where: where(f), orderBy: [{ yearLeft: 'desc' }, { student: { surname: 'asc' } }, { student: { firstName: 'asc' } }], take: 10_000,
      include: { student: { select: { fullName: true, admissionNumber: true } } },
    });
    const headers = ['Name', 'Admission number', 'Year left', 'Last class', 'Phone', 'Email', 'Went on to'];
    const data: CsvCell[][] = rows.map((a) => [a.student.fullName, a.student.admissionNumber, a.yearLeft, a.lastClass, a.phone, a.email, a.destination]);
    await logAudit(
      { schoolId: user.schoolId, actorId: user.id, action: 'EXPORT_ALUMNI', entityType: 'Alumnus', entityId: 'export', detail: `Alumni contact list: ${rows.length} person(s)`, after: { count: rows.length, filters: { q: f.q || null, year: f.year ?? null } } },
      tx,
    );
    return { count: rows.length, csv: toCsv(headers, data) };
  });
}
