// A small school for the HR tests on top of the two-school seed: people who hold the HR roles. Every person is a different human,
// because the rules are about two different people.
import type { PrismaClient } from '@prisma/client';
import type { SeededSchool } from './seed';
import { actorOf, addTeacher } from './academics';

export type Actor = Awaited<ReturnType<typeof actorOf>>;

export interface HrWorld {
  hr: Actor;        // HR_OFFICER: records, pay, payroll preparation, leave adjustments
  hr2: Actor;       // a second HR officer
  head: Actor;      // HEAD: approves leave, posts, rosters
  deputy: Actor;    // DEPUTY_HEAD: builds the roster, cover list
  owner: Actor;     // DIRECTOR user -> OWNER: "*"
  admin: Actor;     // ADMIN user -> ADMINISTRATOR: "*", but not HR data
  bursar: Actor;    // BURSAR: pays payroll, confirms tax settings
  teacher: Actor;   // TEACHER (government-paid, linked to an employee)
  teacher2: Actor;  // TEACHER (school-paid)
  outsider: Actor;  // TEACHER with no staff record
}

export async function hrWorld(prisma: PrismaClient, S: SeededSchool): Promise<HrWorld> {
  const hrId = await addTeacher(prisma, S, 'HR Hannah', ['HR_OFFICER']);
  const hr2Id = await addTeacher(prisma, S, 'HR Helen', ['HR_OFFICER']);
  const deputyId = await addTeacher(prisma, S, 'Deputy Dan', ['DEPUTY_HEAD']);
  const t2 = await addTeacher(prisma, S, 'Mrs Teacher Two');
  const outsiderId = await addTeacher(prisma, S, 'Mr Outsider');
  const [hr, hr2, head, deputy, owner, admin, bursar, teacher, teacher2, outsider] = await Promise.all([
    actorOf(prisma, hrId), actorOf(prisma, hr2Id), actorOf(prisma, S.users.HEAD.id), actorOf(prisma, deputyId), actorOf(prisma, S.users.DIRECTOR.id), actorOf(prisma, S.users.ADMIN.id),
    actorOf(prisma, S.users.BURSAR.id), actorOf(prisma, S.users.TEACHER.id), actorOf(prisma, t2), actorOf(prisma, outsiderId),
  ]);
  return { hr, hr2, head, deputy, owner, admin, bursar, teacher, teacher2, outsider };
}

/** An error thrown by a service or a database rule must carry this status (and say this). */
export { fails } from './finance';
