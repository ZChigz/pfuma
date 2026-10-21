// A small school for the Finance tests on top of the two-school seed: people who hold the finance roles, students in the open
// term, and the fee lines of the term. Every person is a different human, because the rules are about two different people.
import { expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SeededSchool } from './seed';
import { actorOf, addTeacher } from './academics';
import { addStudent } from './students';

export type Actor = Awaited<ReturnType<typeof actorOf>>;

export interface FinanceWorld {
  bursar: Actor;     // BURSAR: records payments, verifies other people's, pays out
  clerk: Actor;      // ACCOUNTS_CLERK: records payments only
  head: Actor;       // HEAD: verifies, approves
  owner: Actor;      // DIRECTOR user -> OWNER role: "*"
  admin: Actor;      // ADMIN user -> ADMINISTRATOR role: "*"
  teacher: Actor;    // TEACHER: may only raise expense requests
  outsider: Actor;   // TEACHER of another colleague, to be the second requester
  funds: Record<string, string>; // code -> id
  students: { day1: string; day2: string; boarder: string };
}

export async function financeWorld(prisma: PrismaClient, S: SeededSchool): Promise<FinanceWorld> {
  const clerkId = await addTeacher(prisma, S, 'Clerk Chipo', ['ACCOUNTS_CLERK']);
  const outsiderId = await addTeacher(prisma, S, 'Mr Outsider');
  const [bursar, clerk, head, owner, admin, teacher, outsider] = await Promise.all([
    actorOf(prisma, S.users.BURSAR.id), actorOf(prisma, clerkId), actorOf(prisma, S.users.HEAD.id), actorOf(prisma, S.users.DIRECTOR.id),
    actorOf(prisma, S.users.ADMIN.id), actorOf(prisma, S.users.TEACHER.id), actorOf(prisma, outsiderId),
  ]);
  const day1 = await addStudent(prisma, S, { firstName: 'Tendai', surname: 'Moyo' });
  const day2 = await addStudent(prisma, S, { firstName: 'Rufaro', surname: 'Dube' });
  const boarder = await addStudent(prisma, S, { firstName: 'Tino', surname: 'Ncube', boarding: 'BOARDER' });
  return { bursar, clerk, head, owner, admin, teacher, outsider, funds: {}, students: { day1: day1.id, day2: day2.id, boarder: boarder.id } };
}

/** An error thrown by a service or a database rule must carry this status (and say this). */
export const fails = async (p: Promise<unknown>, status: number, match?: RegExp) => {
  try {
    await p;
  } catch (e) {
    // A body that fails the schema is a ZodError; the route turns it into a 422.
    const err = e as { status?: number; message: string; name?: string };
    const got = err.name === 'ZodError' ? 422 : err.status;
    if (status) expect(got).toBe(status);
    if (match) expect(err.message).toMatch(match);
    return;
  }
  throw new Error('expected the call to fail');
};
