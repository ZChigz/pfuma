// Sports / boarding houses (set up in Settings) and assigning students to them.
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb } from '@/lib/scoped-db';
import { idSchema, loadReachable } from '@/lib/students/common';
import { isAtSchool } from '@/lib/students/rules';

const colour = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour').default('#6B7280');
export const HouseSchema = z.object({
  name: z.string().trim().min(2, 'Give the house a name').max(40),
  colour,
});
export type HouseInput = z.input<typeof HouseSchema>;

export async function listHouses(user: AccessUser) {
  const db = getScopedDb(user.schoolId, user.id);
  const houses = await db.house.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { students: { where: { status: { in: ['ACTIVE', 'SUSPENDED'] } } } } } } });
  return houses.map((h) => ({ id: h.id, name: h.name, colour: h.colour, students: h._count.students }));
}

export async function saveHouse(user: AccessUser, input: HouseInput, houseId?: string) {
  const data = HouseSchema.parse(input);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const clash = await tx.house.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, ...(houseId ? { id: { not: houseId } } : {}) } });
    if (clash) throw new ServiceError(`There is already a house called ${clash.name}`, 409);
    if (!houseId) {
      const h = await tx.house.create({ data: { schoolId: user.schoolId, ...data } });
      await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'CREATE_HOUSE', entityType: 'House', entityId: h.id, detail: h.name, after: data }, tx);
      return h;
    }
    const before = await tx.house.findFirst({ where: { id: houseId } });
    if (!before) throw new ServiceError('House not found', 404);
    const h = await tx.house.update({ where: { id: houseId }, data });
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'UPDATE_HOUSE', entityType: 'House', entityId: h.id, detail: h.name, before: { name: before.name, colour: before.colour }, after: data }, tx);
    return h;
  });
}

export const AssignHouseSchema = z.object({
  studentIds: z.array(idSchema).min(1, 'Choose at least one student').max(500),
  /** null takes the students out of their house. */
  houseId: idSchema.nullable(),
});

/** Puts students in a house (or none). One audit entry per student with the house before and after. */
export async function assignHouse(user: AccessUser, rawInput: z.input<typeof AssignHouseSchema>) {
  const input = AssignHouseSchema.parse(rawInput);
  const { schoolId } = user;
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const house = input.houseId ? await tx.house.findFirst({ where: { id: input.houseId, schoolId } }) : null;
    if (input.houseId && !house) throw new ServiceError('House not found', 404);
    const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
    const students = await loadReachable(tx, user, input.studentIds, open?.id);
    const away = students.filter((s) => !isAtSchool(s.status));
    if (away.length) throw new ServiceError(`Only students at the school can join a house: ${away.map((s) => s.fullName).join(', ')}`, 409);

    const before = await tx.house.findMany({ where: { id: { in: students.flatMap((s) => (s.houseId ? [s.houseId] : [])) } }, select: { id: true, name: true } });
    const nameOf = new Map(before.map((h) => [h.id, h.name]));
    let changed = 0;
    for (const s of students) {
      if (s.houseId === (house?.id ?? null)) continue;
      await tx.student.update({ where: { id: s.id }, data: { houseId: house?.id ?? null } });
      await logAudit(
        {
          schoolId, actorId: user.id, action: 'ASSIGN_HOUSE', entityType: 'Student', entityId: s.id,
          detail: `${s.fullName}: ${s.houseId ? nameOf.get(s.houseId) ?? 'a house' : 'no house'} → ${house?.name ?? 'no house'}`,
          before: { houseId: s.houseId }, after: { houseId: house?.id ?? null },
        },
        tx,
      );
      changed++;
    }
    return { changed, houseName: house?.name ?? null };
  });
}
