// Academic years and terms. The current term is the school's single OPEN
// AcademicTerm (also enforced by the partial unique index
// "AcademicTerm_one_open_per_school").
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import {
  canCloseTerm,
  canOpenTerm,
  defaultTermDates,
  LEVEL_DEFINITIONS,
  TERMS_PER_YEAR,
  termName,
  validateTermDates,
} from '@/lib/academic/rules';

type Db = Prisma.TransactionClient | typeof prisma;

export const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function getOpenTerm(schoolId: string, db: Db = prisma) {
  return db.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' } });
}

export async function requireOpenTerm(schoolId: string, db: Db = prisma) {
  const term = await getOpenTerm(schoolId, db);
  if (!term) {
    throw new ServiceError('No term is open. Open a term under Admin → Academic calendar first.', 409);
  }
  return term;
}

// A term id supplied by a client must belong to the caller's school.
export async function requireTerm(schoolId: string, termId: string, db: Db = prisma) {
  const term = await db.academicTerm.findFirst({ where: { id: termId, schoolId } });
  if (!term) throw new ServiceError('Term not found', 404);
  return term;
}

// Terms newest first, for dropdowns.
export async function listTerms(schoolId: string, db: Db = prisma) {
  return db.academicTerm.findMany({
    where: { schoolId },
    orderBy: [{ startDate: 'desc' }],
    select: { id: true, name: true, status: true, termNumber: true, startDate: true, endDate: true, academicYearId: true },
  });
}

// Every school has Form 1–6. Idempotent.
export async function ensureLevels(schoolId: string, db: Db = prisma) {
  for (const l of LEVEL_DEFINITIONS) {
    await db.level.upsert({
      where: { schoolId_order: { schoolId, order: l.order } },
      update: {},
      create: { schoolId, name: l.name, order: l.order, category: l.category },
    });
  }
  return db.level.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
}

// ─── Years ───────────────────────────────────────────────────────────────────

export async function createAcademicYear(
  schoolId: string,
  actorId: string,
  input: { year: number; startDate?: string; endDate?: string },
) {
  const { year } = input;
  const startDate = input.startDate ?? `${year}-01-01`;
  const endDate = input.endDate ?? `${year}-12-31`;
  if (startDate > endDate) throw new ServiceError('The academic year must start before it ends', 422);

  const exists = await prisma.academicYear.findUnique({ where: { schoolId_year: { schoolId, year } } });
  if (exists) throw new ServiceError(`The ${year} academic year already exists`, 409);

  const terms = Array.from({ length: TERMS_PER_YEAR }, (_, i) => ({ termNumber: i + 1, ...defaultTermDates(year, i + 1) }))
    .map((t) => ({
      ...t,
      // Clamp the default dates into a custom year range.
      startDate: t.startDate < startDate ? startDate : t.startDate,
      endDate: t.endDate > endDate ? endDate : t.endDate,
    }));
  const problem = validateTermDates(year, startDate, endDate, terms);
  if (problem) throw new ServiceError(`${problem}. Adjust the year dates.`, 422);

  return prisma.$transaction(async (tx) => {
    const y = await tx.academicYear.create({
      data: { schoolId, year, startDate: dateOnly(startDate), endDate: dateOnly(endDate) },
    });
    await tx.academicTerm.createMany({
      data: terms.map((t) => ({
        schoolId,
        academicYearId: y.id,
        termNumber: t.termNumber,
        name: termName(t.termNumber, year),
        startDate: dateOnly(t.startDate),
        endDate: dateOnly(t.endDate),
      })),
    });
    await logAudit(
      { schoolId, actorId, action: 'CREATE_ACADEMIC_YEAR', entityType: 'AcademicYear', entityId: y.id, detail: `${year} (${startDate} to ${endDate})` },
      tx,
    );
    return y;
  });
}

// ─── Terms ───────────────────────────────────────────────────────────────────

export async function updateTermDates(
  schoolId: string,
  actorId: string,
  termId: string,
  input: { startDate: string; endDate: string },
) {
  const term = await requireTerm(schoolId, termId);
  const year = await prisma.academicYear.findUniqueOrThrow({
    where: { id: term.academicYearId },
    include: { terms: true },
  });
  const proposed = year.terms.map((t) => ({
    termNumber: t.termNumber,
    startDate: t.id === termId ? input.startDate : isoDate(t.startDate),
    endDate: t.id === termId ? input.endDate : isoDate(t.endDate),
  }));
  const problem = validateTermDates(year.year, isoDate(year.startDate), isoDate(year.endDate), proposed);
  if (problem) throw new ServiceError(problem, 422);

  return prisma.$transaction(async (tx) => {
    const t = await tx.academicTerm.update({
      where: { id: termId },
      data: { startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate) },
    });
    await logAudit(
      { schoolId, actorId, action: 'UPDATE_ACADEMIC_TERM', entityType: 'AcademicTerm', entityId: t.id, detail: `${t.name}: ${input.startDate} to ${input.endDate}` },
      tx,
    );
    return t;
  });
}

// Opening a term:
//  • only a PLANNED term, and only when no other term is open;
//  • Term 1 of a new year needs a decision (promote/repeat/graduate/leave) for
//    every student still active in the previous year's last term;
//  • every other active student carries over into the same class;
//  • Student.currentClassId is refreshed for the new term.
export async function openTerm(schoolId: string, actorId: string, termId: string) {
  return prisma.$transaction(async (tx) => {
    const term = await requireTerm(schoolId, termId, tx);
    const open = await getOpenTerm(schoolId, tx);
    const problem = canOpenTerm(term, open, termId);
    if (problem) throw new ServiceError(problem, 409);

    // Most recent earlier term with any enrollment — the term students carry over from.
    const previous = await tx.academicTerm.findFirst({
      where: { schoolId, startDate: { lt: term.startDate }, enrollments: { some: {} } },
      orderBy: { startDate: 'desc' },
    });

    if (previous) {
      const carryOver = await tx.enrollment.findMany({
        where: {
          termId: previous.id,
          status: 'ACTIVE',
          student: { status: { in: ['ACTIVE', 'SUSPENDED'] }, enrollments: { none: { termId } } },
        },
        select: { studentId: true, classId: true },
      });

      if (previous.academicYearId !== term.academicYearId && carryOver.length > 0) {
        throw new ServiceError(
          `${carryOver.length} student(s) in ${previous.name} have no end-of-year decision. ` +
          'Promote, repeat, graduate or withdraw them under Admin → Promotions before opening a new year.',
          409,
        );
      }

      const startDate = term.startDate;
      await tx.enrollment.createMany({
        data: carryOver.map((e) => ({
          schoolId, studentId: e.studentId, classId: e.classId, termId, status: 'ACTIVE' as const, startDate,
        })),
      });
      // The previous term's enrollments ended normally.
      await tx.enrollment.updateMany({
        where: { termId: previous.id, status: 'ACTIVE', endDate: null },
        data: { endDate: previous.endDate },
      });
    }

    await tx.academicTerm.update({ where: { id: termId }, data: { status: 'OPEN' } });
    await refreshCurrentClasses(tx, schoolId, termId);
    await logAudit(
      { schoolId, actorId, action: 'OPEN_TERM', entityType: 'AcademicTerm', entityId: termId, detail: term.name },
      tx,
    );
    return tx.academicTerm.findUniqueOrThrow({ where: { id: termId } });
  });
}

export async function closeTerm(schoolId: string, actorId: string, termId: string) {
  return prisma.$transaction(async (tx) => {
    const term = await requireTerm(schoolId, termId, tx);
    const problem = canCloseTerm(term);
    if (problem) throw new ServiceError(problem, 409);

    const t = await tx.academicTerm.update({
      where: { id: termId },
      data: { status: 'CLOSED', closedAt: new Date(), closedById: actorId },
    });
    await logAudit(
      { schoolId, actorId, action: 'CLOSE_TERM', entityType: 'AcademicTerm', entityId: termId, detail: term.name },
      tx,
    );
    return t;
  });
}

// Sets every student's cached currentClassId from their ACTIVE enrollment in termId.
export async function refreshCurrentClasses(tx: Prisma.TransactionClient, schoolId: string, termId: string) {
  await tx.student.updateMany({ where: { schoolId }, data: { currentClassId: null } });
  const enrollments = await tx.enrollment.findMany({
    where: { schoolId, termId, status: 'ACTIVE', student: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
    select: { studentId: true, classId: true },
  });
  const byClass = new Map<string, string[]>();
  for (const e of enrollments) byClass.set(e.classId, [...(byClass.get(e.classId) ?? []), e.studentId]);
  for (const [classId, studentIds] of Array.from(byClass)) {
    await tx.student.updateMany({ where: { id: { in: studentIds } }, data: { currentClassId: classId } });
  }
}
