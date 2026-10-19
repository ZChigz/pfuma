// Builds students for the Student Information tests.
import type { PrismaClient } from '@prisma/client';
import type { SeededSchool } from './seed';

let counter = 0;

export interface NewStudent {
  firstName?: string;
  surname?: string;
  gender?: 'M' | 'F';
  classId?: string;
  boarding?: 'DAY' | 'BOARDER';
  status?: 'ACTIVE' | 'SUSPENDED' | 'TRANSFERRED' | 'GRADUATED' | 'WITHDRAWN' | 'EXPELLED' | 'DECEASED';
  admissionDate?: string;
  phone?: string;
}

/** A student with an Enrollment in the school's open term (for students at the school) and one primary guardian. */
export async function addStudent(prisma: PrismaClient, S: SeededSchool, o: NewStudent = {}) {
  counter++;
  const klass = o.classId ?? S.classId;
  const status = o.status ?? 'ACTIVE';
  const atSchool = status === 'ACTIVE' || status === 'SUSPENDED';
  const first = o.firstName ?? `Pupil${counter}`;
  const surname = o.surname ?? `Test${counter}`;
  const s = await prisma.student.create({
    data: {
      schoolId: S.schoolId, admissionNumber: `T${S.schoolId.slice(-4)}${counter}`.toUpperCase(), firstName: first, surname, fullName: `${first} ${surname}`,
      gender: o.gender ?? 'M', dateOfBirth: new Date('2013-06-01'), admissionDate: new Date(o.admissionDate ?? '2026-01-10'),
      currentClassId: atSchool ? klass : null, boarding: o.boarding ?? 'DAY', status,
    },
  });
  await prisma.enrollment.create({
    data: {
      schoolId: S.schoolId, studentId: s.id, classId: klass, termId: S.termId, startDate: new Date('2026-01-10'),
      status: atSchool ? 'ACTIVE' : status === 'TRANSFERRED' ? 'TRANSFERRED_OUT' : status === 'GRADUATED' ? 'GRADUATED' : 'WITHDRAWN',
      endDate: atSchool ? null : new Date('2026-06-01'),
    },
  });
  const phone = o.phone ?? `+26377${String(1000000 + counter).slice(-7)}`;
  // A phone number belongs to one guardian per school, so students given the same number share the record.
  const g = await prisma.guardian.upsert({ where: { schoolId_phone: { schoolId: S.schoolId, phone } }, update: {}, create: { schoolId: S.schoolId, fullName: `Guardian ${counter}`, phone } });
  await prisma.studentGuardian.create({ data: { studentId: s.id, guardianId: g.id, relationship: 'MOTHER', isPrimary: true } });
  return s;
}

export async function addClass(prisma: PrismaClient, S: SeededSchool, name: string, opts: { capacity?: number; order?: number; stream?: string } = {}) {
  const order = opts.order ?? 2;
  const level = await prisma.level.upsert({
    where: { schoolId_name: { schoolId: S.schoolId, name: `Form ${order}` } }, update: {},
    create: { schoolId: S.schoolId, name: `Form ${order}`, order, category: order > 4 ? 'A_LEVEL' : 'O_LEVEL' },
  });
  return prisma.schoolClass.create({
    data: { schoolId: S.schoolId, name, levelId: level.id, stream: opts.stream ?? name.split(' ').pop()!, capacity: opts.capacity ?? 45 },
  });
}

/** YYYY-MM-DD for today in Harare, shifted by a number of days. */
export function dayOffset(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
