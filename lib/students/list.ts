// The Students list: search, filters, counts for the selected term, and the rows. Every query is
// scoped to the school and to the students the user may reach (lib/students/scope.ts).
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AccessUser } from '@/lib/access-core';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { ageOn, todayInHarare } from '@/lib/students/registration';
import { studentAccess } from '@/lib/students/rules';
import { studentScope } from '@/lib/students/scope';

export const MIN_SEARCH_LENGTH = 2;
export const PAGE_SIZES = [25, 50, 100] as const;
export const SORTS = ['name', 'admissionNumber', 'class', 'admissionDate'] as const;
export const COUNT_FILTERS = ['active', 'boarders', 'day', 'new', 'suspended'] as const;
export const OPTIONAL_COLUMNS = ['house', 'dateOfBirth', 'admissionDate', 'previousSchool'] as const;
export const STATUS_VALUES = ['ACTIVE', 'SUSPENDED', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'EXPELLED', 'DECEASED'] as const;

const flag = z.enum(['1', 'true', 'yes']).optional().transform((v) => (v ? true : undefined));
const text = z.string().trim().max(100).optional().transform((v) => v || undefined);

export const StudentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().transform((v) => v ?? ''),
  termId: text,
  form: z.coerce.number().int().min(1).max(6).optional(),
  classId: text,
  stream: text,
  gender: z.enum(['M', 'F']).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  boarding: z.enum(['DAY', 'BOARDER']).optional(),
  houseId: text,
  beam: flag,
  sponsored: flag,
  specialNeeds: flag,
  admissionYear: z.coerce.number().int().min(1950).max(2200).optional(),
  count: z.enum(COUNT_FILTERS).optional(),
  sort: z.enum(SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().refine((n) => (PAGE_SIZES as readonly number[]).includes(n)).default(25),
});
export type StudentListQuery = z.infer<typeof StudentListQuerySchema>;

/** Query-string parameters in, a clean query out. Anything unrecognised is dropped, never an error. */
export function parseStudentListQuery(params: URLSearchParams | Record<string, string | string[] | undefined>): StudentListQuery {
  const raw: Record<string, string> = {};
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : Array.isArray(params[k]) ? (params[k] as string[])[0] : (params[k] as string | undefined));
  for (const key of Object.keys(StudentListQuerySchema.shape)) {
    const v = get(key);
    if (v !== null && v !== undefined && v !== '') raw[key] = v;
  }
  // A bad value for one filter must not break the page: drop that filter and keep the rest.
  for (let i = 0; i < 20; i++) {
    const r = StudentListQuerySchema.safeParse(raw);
    if (r.success) return r.data;
    const bad = new Set(r.error.issues.map((x) => String(x.path[0])));
    if (bad.size === 0) break;
    for (const k of Array.from(bad)) delete raw[k];
  }
  return StudentListQuerySchema.parse({});
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Search words become conditions on name, admission number, birth certificate number and guardian phone. */
export function searchWhere(q: string): Prisma.StudentWhereInput | undefined {
  const term = q.trim();
  if (term.length < MIN_SEARCH_LENGTH) return undefined;
  const or: Prisma.StudentWhereInput[] = [];

  // Every word must match somewhere in the name, so "tendai moyo" finds Tendai Moyo and "moyo tendai" too.
  const words = term.split(/\s+/).filter(Boolean);
  or.push({
    AND: words.map((w) => ({
      OR: [
        { fullName: { contains: w, mode: 'insensitive' } },
        { preferredName: { contains: w, mode: 'insensitive' } },
        { surname: { contains: w, mode: 'insensitive' } },
      ],
    })),
  });
  or.push({ admissionNumber: { contains: term, mode: 'insensitive' } });

  const cert = term.replace(/[\s/-]+/g, '').toUpperCase();
  if (cert.length >= MIN_SEARCH_LENGTH && /^[0-9A-Z]+$/.test(cert)) or.push({ birthCertificateNumber: { contains: cert } });

  const digits = term.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length === term.replace(/[\s+\-()]/g, '').length) {
    // 0772 111 222, +263 772 111 222 and 772111222 all find +263772111222.
    const national = digits.replace(/^(?:00)?263/, '').replace(/^0/, '');
    if (national.length >= 3) or.push({ guardians: { some: { guardian: { phone: { contains: national } } } } });
  }
  return { OR: or };
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function enrolledIn(termId: string | null, klass: Prisma.SchoolClassWhereInput): Prisma.StudentWhereInput {
  return { enrollments: { some: { ...(termId ? { termId } : {}), status: 'ACTIVE', class: klass } } };
}

export async function listWhere(query: StudentListQuery, user: AccessUser, term: { id: string; startDate: Date } | null, db?: Db): Promise<Prisma.StudentWhereInput> {
  const and: Prisma.StudentWhereInput[] = [await studentScope(user, term?.id, undefined, db)];
  const search = searchWhere(query.q);
  if (search) and.push(search);

  // The default list is the students at the school; choosing a status (or a count) widens or narrows it.
  const status = query.count === 'suspended' ? 'SUSPENDED' : query.count === 'active' ? 'ACTIVE' : query.status;
  and.push(status ? { status } : { status: { in: ['ACTIVE', 'SUSPENDED'] } });

  const klass: Prisma.SchoolClassWhereInput = {};
  if (query.classId) klass.id = query.classId;
  if (query.form) klass.level = { order: query.form };
  if (query.stream) klass.stream = { equals: query.stream, mode: 'insensitive' };
  if (Object.keys(klass).length) and.push(enrolledIn(term?.id ?? null, klass));

  if (query.gender) and.push({ gender: query.gender });
  const boarding = query.count === 'boarders' ? 'BOARDER' : query.count === 'day' ? 'DAY' : query.boarding;
  if (boarding) and.push({ boarding });
  if (query.houseId) and.push({ houseId: query.houseId });
  if (query.beam) and.push({ isBeam: true });
  if (query.sponsored) and.push({ sponsorName: { not: null } });
  if (query.specialNeeds) and.push({ specialNeeds: true });
  if (query.admissionYear) {
    and.push({ admissionDate: { gte: new Date(Date.UTC(query.admissionYear, 0, 1)), lt: new Date(Date.UTC(query.admissionYear + 1, 0, 1)) } });
  }
  if (query.count === 'new' && term) and.push({ admissionDate: { gte: term.startDate } });
  return { AND: and };
}

function orderBy(query: StudentListQuery): Prisma.StudentOrderByWithRelationInput[] {
  const d = query.dir;
  switch (query.sort) {
    case 'admissionNumber': return [{ admissionNumber: d }];
    case 'admissionDate': return [{ admissionDate: d }, { surname: 'asc' }];
    case 'class': return [{ currentClass: { name: d } }, { surname: 'asc' }, { firstName: 'asc' }];
    default: return [{ surname: d }, { firstName: d }];
  }
}

// ─── Counts ──────────────────────────────────────────────────────────────────

export interface StudentCounts { active: number; boarders: number; day: number; new: number; suspended: number }

/** The five numbers above the table, for the students at the school in the selected term. */
export async function studentCounts(db: Db, user: AccessUser, term: { id: string; startDate: Date } | null): Promise<StudentCounts> {
  const scope = await studentScope(user, term?.id, undefined, db);
  const atSchool: Prisma.StudentWhereInput = { AND: [scope, { status: { in: ['ACTIVE', 'SUSPENDED'] } }, ...(term ? [enrolledIn(term.id, {})] : [])] };
  const [active, suspended, boarders, day, fresh] = await Promise.all([
    db.student.count({ where: { AND: [atSchool, { status: 'ACTIVE' }] } }),
    db.student.count({ where: { AND: [atSchool, { status: 'SUSPENDED' }] } }),
    db.student.count({ where: { AND: [atSchool, { boarding: 'BOARDER' }] } }),
    db.student.count({ where: { AND: [atSchool, { boarding: 'DAY' }] } }),
    term ? db.student.count({ where: { AND: [atSchool, { admissionDate: { gte: term.startDate } }] } }) : Promise.resolve(0),
  ]);
  return { active, suspended, boarders, day, new: fresh };
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface StudentRow {
  id: string;
  admissionNumber: string;
  firstName: string;
  surname: string;
  fullName: string;
  preferredName: string | null;
  photoUrl: string | null;
  gender: 'M' | 'F' | null;
  age: number | null;
  dateOfBirth: string | null;
  admissionDate: string;
  previousSchool: string | null;
  status: string;
  boarding: 'DAY' | 'BOARDER';
  className: string | null;
  classId: string | null;
  houseName: string | null;
  houseColour: string | null;
  /** Null when the user may not see guardians. */
  guardianName: string | null;
  guardianPhone: string | null;
  specialNeeds: boolean;
}

export interface StudentListResult {
  term: { id: string; name: string; startDate: string } | null;
  counts: StudentCounts;
  rows: StudentRow[];
  total: number;
  page: number;
  pageSize: number;
  searchTooShort: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function selectedTerm(db: Db, schoolId: string, termId?: string) {
  const term = termId
    ? await db.academicTerm.findFirst({ where: { id: termId, schoolId } })
    : await db.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
  return term ?? (termId ? null : await db.academicTerm.findFirst({ where: { schoolId }, orderBy: { startDate: 'desc' } }));
}

const ROW_SELECT = {
  id: true, admissionNumber: true, firstName: true, surname: true, fullName: true, preferredName: true, photoUrl: true, gender: true,
  dateOfBirth: true, admissionDate: true, previousSchool: true, status: true, boarding: true, specialNeeds: true,
  currentClass: { select: { id: true, name: true } },
  house: { select: { name: true, colour: true } },
} satisfies Prisma.StudentSelect;

export async function listStudents(user: AccessUser, query: StudentListQuery): Promise<StudentListResult> {
  const db = getScopedDb(user.schoolId, user.id);
  const access = studentAccess(user);
  const termRow = await selectedTerm(db, user.schoolId, query.termId);
  const term = termRow ? { id: termRow.id, startDate: termRow.startDate } : null;
  const where = await listWhere(query, user, term, db);

  const [total, students, counts] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({
      where,
      select: { ...ROW_SELECT, ...(access.guardians ? { guardians: { where: { isPrimary: true }, take: 1, select: { guardian: { select: { fullName: true, phone: true } } } } } : {}) },
      orderBy: orderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    studentCounts(db, user, term),
  ]);

  const today = todayInHarare();
  const rows: StudentRow[] = students.map((s) => {
    const primary = (s as unknown as { guardians?: { guardian: { fullName: string; phone: string } }[] }).guardians?.[0]?.guardian;
    return {
      id: s.id,
      admissionNumber: s.admissionNumber,
      firstName: s.firstName,
      surname: s.surname,
      fullName: s.fullName,
      preferredName: s.preferredName,
      photoUrl: s.photoUrl,
      gender: s.gender,
      age: s.dateOfBirth ? ageOn(iso(s.dateOfBirth)!, today) : null,
      dateOfBirth: iso(s.dateOfBirth),
      admissionDate: iso(s.admissionDate)!,
      previousSchool: s.previousSchool,
      status: s.status,
      boarding: s.boarding,
      className: s.currentClass?.name ?? null,
      classId: s.currentClass?.id ?? null,
      houseName: s.house?.name ?? null,
      houseColour: s.house?.colour ?? null,
      guardianName: access.guardians ? primary?.fullName ?? null : null,
      guardianPhone: access.guardians ? primary?.phone ?? null : null,
      specialNeeds: s.specialNeeds,
    };
  });

  return {
    term: termRow ? { id: termRow.id, name: termRow.name, startDate: iso(termRow.startDate)! } : null,
    counts, rows, total, page: query.page, pageSize: query.pageSize,
    searchTooShort: query.q.trim().length > 0 && query.q.trim().length < MIN_SEARCH_LENGTH,
  };
}

// ─── A light search, for picking students (record an incident, add to an alumni list ...) ───────────────

/** Up to ten students matching the words typed, with just enough to tell two children apart. Scoped like the list. */
export async function searchStudentsLite(user: AccessUser, q: string, opts: { includeLeft?: boolean } = {}) {
  const db = getScopedDb(user.schoolId, user.id);
  const open = await db.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true } });
  const search = searchWhere(q);
  if (!search) return [];
  const rows = await db.student.findMany({
    where: { AND: [await studentScope(user, open?.id, undefined, db), search, opts.includeLeft ? {} : { status: { in: ['ACTIVE', 'SUSPENDED'] } }] },
    select: { id: true, fullName: true, admissionNumber: true, status: true, currentClass: { select: { name: true } } },
    orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
    take: 10,
  });
  return rows.map((s) => ({ id: s.id, fullName: s.fullName, admissionNumber: s.admissionNumber, status: s.status, className: s.currentClass?.name ?? null }));
}
