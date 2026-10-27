// Builds a small school for the Academics tests: forms, classes, departments, subjects, teachers, a bell schedule and
// students, on top of the two-school seed. The clock is fixed to a Wednesday inside the seeded term so "today" is a school day.
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { SeededSchool } from './seed';
import { addStudent } from './students';

/** Wednesday 14 October 2026, 10:00 in Harare. The seeded term runs 10 Jan to 20 Dec 2026. */
export const NOW = new Date('2026-10-14T08:00:00Z');
export const TODAY = '2026-10-14';
export const day = (offset: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

let n = 0;

export interface World {
  form1: string; form2: string; form3: string;
  f1North: string; f1South: string; f2East: string; f3North: string;
  dept: { sciences: string; languages: string; humanities: string };
  subjects: { maths: string; english: string; science: string; geography: string; history: string; accounts: string; physics: string };
  teachers: { chikore: string; moyo: string; ncube: string; dube: string };
  periods: { id: string; day: number; no: number; type: string }[];
  rooms: { room1: string; lab: string };
}

/** Someone with the TEACHER role (the database gives the role matching the legacy access level). */
export async function addTeacher(prisma: PrismaClient, S: SeededSchool, fullName: string, extraRoles: string[] = []): Promise<string> {
  n++;
  const u = await prisma.user.create({
    data: { schoolId: S.schoolId, fullName, email: `t${n}.${S.schoolId.slice(-5)}@x.test`, role: 'TEACHER', passwordHash: await bcrypt.hash('Correct-horse-1', 4) },
  });
  for (const key of extraRoles) {
    const role = await prisma.roleDefinition.findFirstOrThrow({ where: { schoolId: S.schoolId, key } });
    await prisma.userRole.create({ data: { schoolId: S.schoolId, userId: u.id, roleId: role.id } });
  }
  return u.id;
}

export async function sessionFor(prisma: PrismaClient, userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return { id: u.id, email: u.email, schoolId: u.schoolId, role: u.role, fullName: u.fullName };
}

/** The permission context a service call needs: exactly what requirePermission builds from the database (roles, grants with their scopes, exceptions). */
export async function actorOf(prisma: PrismaClient, userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { loadAccessContext } = await import('@/lib/access');
  return loadAccessContext({ user: { id: u.id, schoolId: u.schoolId, role: u.role, email: u.email, fullName: u.fullName } });
}

/** Forms 1-3, four classes, three departments, seven subjects, four teachers, a Monday-Friday bell schedule and two rooms. */
export async function buildWorld(prisma: PrismaClient, S: SeededSchool): Promise<World> {
  const sid = S.schoolId;
  await prisma.academicTerm.update({ where: { id: S.termId }, data: { startDate: new Date('2026-09-01'), endDate: new Date('2026-12-20') } });
  const lvl = async (order: number) => (await prisma.level.upsert({ where: { schoolId_order: { schoolId: sid, order } }, update: {}, create: { schoolId: sid, name: `Form ${order}`, order, category: order > 4 ? 'A_LEVEL' : 'O_LEVEL' } })).id;
  const [form1, form2, form3] = [await lvl(1), await lvl(2), await lvl(3)];
  const cls = async (name: string, levelId: string, stream: string) => (await prisma.schoolClass.create({ data: { schoolId: sid, name, levelId, stream } })).id;
  const f1South = await cls('Form 1 South', form1, 'South');
  const f2East = await cls('Form 2 East', form2, 'East');
  const f3North = await cls('Form 3 North', form3, 'North');

  const dep = async (name: string) => (await prisma.department.create({ data: { schoolId: sid, name } })).id;
  const [sciences, languages, humanities] = [await dep('Sciences'), await dep('Languages'), await dep('Humanities')];
  const subj = async (name: string, short: string, code: string, departmentId: string, levels: [string, 'CORE' | 'ELECTIVE'][], practical = false) => {
    n++;
    const s = await prisma.subject.create({ data: { schoolId: sid, name, shortName: short, code: `${code}${n}`, departmentId, isPractical: practical } });
    await prisma.subjectLevel.createMany({ data: levels.map(([levelId, type]) => ({ schoolId: sid, subjectId: s.id, levelId, type })) });
    return s.id;
  };
  const subjects = {
    maths: await subj('Mathematics', 'Maths', 'MAT', sciences, [[form1, 'CORE'], [form2, 'CORE'], [form3, 'CORE']]),
    english: await subj('English Language', 'English', 'ENG', languages, [[form1, 'CORE'], [form2, 'CORE'], [form3, 'CORE']]),
    science: await subj('Combined Science', 'Comb Sci', 'CSC', sciences, [[form1, 'CORE'], [form2, 'CORE']], true),
    geography: await subj('Geography', 'Geography', 'GEO', humanities, [[form1, 'CORE'], [form2, 'ELECTIVE'], [form3, 'ELECTIVE']]),
    history: await subj('History', 'History', 'HIS', humanities, [[form2, 'ELECTIVE'], [form3, 'ELECTIVE']]),
    accounts: await subj('Accounts', 'Accounts', 'ACC', humanities, [[form3, 'ELECTIVE']]),
    physics: await subj('Physics', 'Physics', 'PHY', sciences, [[form3, 'ELECTIVE']], true),
  };

  const teachers = {
    chikore: await addTeacher(prisma, S, 'Mr Tendai Chikore'),
    moyo: await addTeacher(prisma, S, 'Mrs Rudo Moyo'),
    ncube: await addTeacher(prisma, S, 'Ms Thando Ncube'),
    dube: await addTeacher(prisma, S, 'Mr Farai Dube'),
  };

  // Monday to Friday: three lessons, tea, three lessons (Friday is short: no sixth period).
  const sched = await prisma.bellSchedule.create({ data: { schoolId: sid, name: 'Bell schedule' } });
  const rows = [
    [1, '07:30', '08:05', 'LESSON'], [2, '08:05', '08:40', 'LESSON'], [3, '08:40', '09:15', 'LESSON'], [4, '09:15', '09:35', 'BREAK'],
    [5, '09:35', '10:10', 'LESSON'], [6, '10:10', '10:45', 'LESSON'], [7, '10:45', '11:20', 'LESSON'],
  ] as const;
  const periods: World['periods'] = [];
  for (let d = 1; d <= 5; d++) {
    for (const [no, start, end, type] of rows) {
      if (d === 5 && no === 7) continue;
      const p = await prisma.period.create({ data: { schoolId: sid, scheduleId: sched.id, periodNo: no, dayOfWeek: d, start, end, type, label: type === 'BREAK' ? 'Tea' : null } });
      periods.push({ id: p.id, day: d, no, type });
    }
  }
  const rooms = {
    room1: (await prisma.room.create({ data: { schoolId: sid, name: 'Room 1', type: 'CLASSROOM', capacity: 45 } })).id,
    lab: (await prisma.room.create({ data: { schoolId: sid, name: 'Science Lab', type: 'LABORATORY', capacity: 40 } })).id,
  };
  return { form1, form2, form3, f1North: S.classId, f1South, f2East, f3North, dept: { sciences, languages, humanities }, subjects, teachers, periods, rooms };
}

export const periodAt = (w: World, day: number, no: number) => w.periods.find((p) => p.day === day && p.no === no)!.id;

export async function students(prisma: PrismaClient, S: SeededSchool, classId: string, count: number, prefix = 'Pupil') {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const s = await addStudent(prisma, S, { classId, firstName: `${prefix}${i}`, surname: `${String.fromCharCode(64 + i)}${prefix}`, gender: i % 2 ? 'M' : 'F' });
    out.push(s.id);
  }
  return out;
}

/** An approved, live assignment made straight in the database (the API path is tested separately). */
export async function assign(prisma: PrismaClient, S: SeededSchool, a: { teacherId: string; subjectId: string; classId?: string; groupId?: string; periods?: number; doubles?: number }) {
  return prisma.teacherAssignment.create({
    data: {
      schoolId: S.schoolId, termId: S.termId, teacherId: a.teacherId, subjectId: a.subjectId, classId: a.classId ?? null, groupId: a.groupId ?? null,
      periodsPerWeek: a.periods ?? 4, doublesPerWeek: a.doubles ?? 0, startDate: new Date('2026-09-01'),
    },
  });
}
