// Hostels: structure (hostel, rooms, beds), allocating boarders to beds with history, the roll call (morning, evening, lights out), room
// inspections and the hostel dashboard.
//
// Only a boarder can be given a bed. Giving a day scholar a bed asks to change their status first, which adds the boarding charge in Finance from
// that date (the database refuses a bed for anyone who is not a boarder). A boarding master reaches only their own hostel.
import { z } from 'zod';
import type { FacBedType, FacRollSession, FacRollStatus, Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { can } from '@/lib/access-core';
import { scopeWhere } from '@/lib/access/where';
import { notifyUsers } from '@/lib/system/notifications';
import { deputyIds } from '@/lib/academics/common';
import { adjustForBoardingChange } from '@/lib/finance/billing';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import {
  audit, centsSchema, currencySchema, idSchema, isoDateSchema, isoOf, loadFacSettings, need, optText, textSchema, todayInHarare, toDay, within, type Actor, type Cur,
} from '@/lib/facilities/common';
import { awayStatus } from '@/lib/facilities/away';
import { chargeLearner } from '@/lib/facilities/money';
import { planFill, type Candidate, type FreeRoom } from '@/lib/facilities/hostel-math';

export const SESSIONS = ['MORNING', 'EVENING', 'LIGHTS_OUT'] as const;
export const SESSION_LABEL: Record<(typeof SESSIONS)[number], string> = { MORNING: 'Morning', EVENING: 'Evening', LIGHTS_OUT: 'Lights out' };
export const BED_TYPES = ['SINGLE', 'BUNK_TOP', 'BUNK_BOTTOM'] as const;
export const INSPECTION_ITEMS = ['CLEANLINESS', 'BEDS_MADE', 'LOCKERS', 'DAMAGE'] as const;

const ANY = ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'] as const;
const viewer = (user: Actor) => need(user, ...ANY);
/** The first hostel key the person holds, to work out which hostels that grant reaches. */
const heldKey = (user: Actor): (typeof ANY)[number] => ANY.find((k) => can(user, k)) ?? 'facilities.hostel.view';

/** The hostels the person reaches: all of them, or only their own for a boarding master or matron. */
async function reachable(tx: Db, user: Actor, key: (typeof ANY)[number]) {
  const where = (await scopeWhere(user, key, 'FacHostel', tx)) as Prisma.FacHostelWhereInput;
  return tx.facHostel.findMany({ where: { AND: [where, { schoolId: user.schoolId }] }, orderBy: { name: 'asc' } });
}

const nameOf = async (tx: Db, ids: (string | null)[]) => new Map((await tx.user.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

/** Learners who have left the school do not keep a bed. */
async function vacateLeavers(tx: Db, schoolId: string) {
  const open = await tx.facBedAllocation.findMany({ where: { schoolId, toDate: null }, select: { id: true, studentId: true } });
  if (open.length === 0) return;
  const gone = await tx.student.findMany({ where: { id: { in: open.map((o) => o.studentId) }, status: { notIn: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true } });
  if (gone.length) await tx.facBedAllocation.updateMany({ where: { schoolId, toDate: null, studentId: { in: gone.map((g) => g.id) } }, data: { toDate: toDay(todayInHarare()), reason: 'Left the school' } });
}

// ─── Structure ───────────────────────────────────────────────────────────────

export const HostelSchema = z.object({
  id: idSchema.optional(), name: textSchema('the hostel name', 2, 60), gender: z.enum(['M', 'F']),
  boardingMasterId: idSchema.nullable().optional(), matronId: idSchema.nullable().optional(), capacity: z.number().int().min(0).max(5000).default(0), active: z.boolean().optional(),
});

export async function saveHostel(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.manage');
  const v = HostelSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    for (const uid of [v.boardingMasterId, v.matronId]) if (uid && !(await tx.user.findFirst({ where: { id: uid, schoolId: user.schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Staff member not found', 404);
    if (await tx.facHostel.findFirst({ where: { schoolId: user.schoolId, name: v.name, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } })) throw new ServiceError(`There is already a hostel called ${v.name}`, 409);
    if (!v.id) {
      const h = await tx.facHostel.create({ data: { schoolId: user.schoolId, name: v.name, gender: v.gender, boardingMasterId: v.boardingMasterId ?? null, matronId: v.matronId ?? null, capacity: v.capacity } });
      await audit(tx, user, 'FAC_HOSTEL_SAVE', 'FacHostel', h.id, `Added the hostel ${v.name}`, undefined, { name: v.name, gender: v.gender, capacity: v.capacity });
      return { id: h.id };
    }
    await within(tx, user, 'facilities.hostel.manage', 'FacHostel', v.id);
    const before = await tx.facHostel.findFirstOrThrow({ where: { id: v.id, schoolId: user.schoolId } });
    if (before.gender !== v.gender && (await openCount(tx, user.schoolId, v.id)) > 0) throw new ServiceError('Learners sleep here already, so its gender cannot change', 409);
    if (v.active === false && before.active && (await openCount(tx, user.schoolId, v.id)) > 0) throw new ServiceError('Learners still sleep in this hostel. Move them first.', 409);
    await tx.facHostel.update({ where: { id: v.id }, data: { name: v.name, gender: v.gender, boardingMasterId: v.boardingMasterId === undefined ? before.boardingMasterId : v.boardingMasterId, matronId: v.matronId === undefined ? before.matronId : v.matronId, capacity: v.capacity, active: v.active ?? before.active } });
    await audit(tx, user, 'FAC_HOSTEL_SAVE', 'FacHostel', v.id, `Changed the hostel ${v.name}`, { name: before.name, boardingMasterId: before.boardingMasterId, matronId: before.matronId, capacity: before.capacity, active: before.active }, { name: v.name, boardingMasterId: v.boardingMasterId ?? before.boardingMasterId, matronId: v.matronId ?? before.matronId, capacity: v.capacity, active: v.active ?? before.active });
    return { id: v.id };
  });
}

async function bedIdsOf(tx: Db, schoolId: string, hostelId: string): Promise<string[]> {
  const rooms = await tx.facRoom.findMany({ where: { schoolId, hostelId }, select: { id: true } });
  return (await tx.facBed.findMany({ where: { schoolId, roomId: { in: rooms.map((r) => r.id) } }, select: { id: true } })).map((b) => b.id);
}

async function openCount(tx: Db, schoolId: string, hostelId: string): Promise<number> {
  return tx.facBedAllocation.count({ where: { schoolId, toDate: null, bedId: { in: await bedIdsOf(tx, schoolId, hostelId) } } });
}

export const RoomSchema = z.object({ id: idSchema.optional(), hostelId: idSchema, name: textSchema('the room name', 1, 40), floor: optText(20), capacity: z.number().int().min(0).max(200).default(0), active: z.boolean().optional() });

export async function saveRoom(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.manage');
  const v = RoomSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, 'facilities.hostel.manage', 'FacHostel', v.hostelId);
    if (await tx.facRoom.findFirst({ where: { hostelId: v.hostelId, name: v.name, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } })) throw new ServiceError(`There is already a room called ${v.name} in this hostel`, 409);
    if (!v.id) {
      const r = await tx.facRoom.create({ data: { schoolId: user.schoolId, hostelId: v.hostelId, name: v.name, floor: v.floor ?? null, capacity: v.capacity } });
      await audit(tx, user, 'FAC_HOSTEL_SAVE', 'FacRoom', r.id, `Added the room ${v.name}`, undefined, { hostelId: v.hostelId, name: v.name, capacity: v.capacity });
      return { id: r.id };
    }
    const before = await tx.facRoom.findFirst({ where: { id: v.id, hostelId: v.hostelId, schoolId: user.schoolId } });
    if (!before) throw new ServiceError('Room not found', 404);
    if (v.active === false && before.active) {
      const beds = await tx.facBed.findMany({ where: { roomId: v.id }, select: { id: true } });
      if (await tx.facBedAllocation.count({ where: { toDate: null, bedId: { in: beds.map((b) => b.id) } } })) throw new ServiceError('Learners still sleep in this room. Move them first.', 409);
    }
    await tx.facRoom.update({ where: { id: v.id }, data: { name: v.name, floor: v.floor ?? null, capacity: v.capacity, active: v.active ?? before.active } });
    await audit(tx, user, 'FAC_HOSTEL_SAVE', 'FacRoom', v.id, `Changed the room ${v.name}`, { name: before.name, capacity: before.capacity, active: before.active }, { name: v.name, capacity: v.capacity, active: v.active ?? before.active });
    return { id: v.id };
  });
}

export const BedsSchema = z.object({
  roomId: idSchema, count: z.number().int().min(1).max(100).optional(), numbers: z.array(z.string().trim().min(1).max(10)).max(100).optional(),
  bedType: z.enum(BED_TYPES).default('SINGLE'), lockerPrefix: optText(10),
}).refine((v) => v.count || (v.numbers && v.numbers.length), { message: 'Say how many beds, or give their numbers' });

/** Adds beds to a room: "6 beds" numbers them after the ones already there; or give the numbers. A locker number goes with each bed. */
export async function addBeds(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.manage');
  const v = BedsSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const room = await tx.facRoom.findFirst({ where: { id: v.roomId, schoolId: user.schoolId } });
    if (!room) throw new ServiceError('Room not found', 404);
    await within(tx, user, 'facilities.hostel.manage', 'FacHostel', room.hostelId);
    const have = await tx.facBed.findMany({ where: { roomId: room.id }, select: { number: true } });
    const taken = new Set(have.map((b) => b.number));
    let numbers = v.numbers ?? [];
    if (!numbers.length) {
      const top = Math.max(0, ...have.map((b) => Number(b.number)).filter((n) => Number.isFinite(n)));
      numbers = Array.from({ length: v.count! }, (_, i) => String(top + i + 1));
    }
    if (new Set(numbers).size !== numbers.length) throw new ServiceError('A bed number appears twice', 422);
    const clash = numbers.find((n) => taken.has(n));
    if (clash) throw new ServiceError(`Bed ${clash} already exists in ${room.name}`, 409);
    await tx.facBed.createMany({ data: numbers.map((n) => ({ schoolId: user.schoolId, roomId: room.id, number: n, bedType: v.bedType as FacBedType, lockerNumber: v.lockerPrefix ? `${v.lockerPrefix}${n}` : null })) });
    await audit(tx, user, 'FAC_HOSTEL_SAVE', 'FacRoom', room.id, `Added ${numbers.length} bed${numbers.length === 1 ? '' : 's'} to ${room.name}`, undefined, { numbers, bedType: v.bedType });
    return { added: numbers };
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface HostelCard {
  id: string; name: string; gender: 'M' | 'F'; boardingMaster: string | null; matron: string | null; boardingMasterId: string | null; matronId: string | null; capacity: number; beds: number; filled: number; free: number; rooms: number; active: boolean;
}

export async function listHostels(user: Actor): Promise<HostelCard[]> {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await vacateLeavers(tx, user.schoolId);
    const hostels = await reachable(tx, user, heldKey(user));
    const names = await nameOf(tx, hostels.flatMap((h) => [h.boardingMasterId, h.matronId]));
    const rooms = await tx.facRoom.findMany({ where: { schoolId: user.schoolId, hostelId: { in: hostels.map((h) => h.id) }, active: true }, select: { id: true, hostelId: true } });
    const beds = await tx.facBed.findMany({ where: { schoolId: user.schoolId, roomId: { in: rooms.map((r) => r.id) }, active: true }, select: { id: true, roomId: true } });
    const open = await tx.facBedAllocation.findMany({ where: { schoolId: user.schoolId, toDate: null, bedId: { in: beds.map((b) => b.id) } }, select: { bedId: true } });
    const filledBeds = new Set(open.map((o) => o.bedId));
    return hostels.map((h) => {
      const rs = rooms.filter((r) => r.hostelId === h.id).map((r) => r.id);
      const bs = beds.filter((b) => rs.includes(b.roomId));
      const filled = bs.filter((b) => filledBeds.has(b.id)).length;
      return { id: h.id, name: h.name, gender: h.gender, boardingMaster: names.get(h.boardingMasterId ?? '') ?? null, matron: names.get(h.matronId ?? '') ?? null, boardingMasterId: h.boardingMasterId, matronId: h.matronId, capacity: h.capacity, beds: bs.length, filled, free: bs.length - filled, rooms: rs.length, active: h.active };
    });
  });
}

export interface BedView { id: string; number: string; bedType: string; locker: string | null; active: boolean; studentId: string | null; student: string | null; admissionNumber: string | null; className: string | null; since: string | null }
export interface RoomView { id: string; name: string; floor: string | null; capacity: number; active: boolean; beds: BedView[] }

export async function getHostel(user: Actor, id: string) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const h = await tx.facHostel.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!h) throw new ServiceError('Hostel not found', 404);
    const key = heldKey(user);
    await within(tx, user, key, 'FacHostel', id);
    await vacateLeavers(tx, user.schoolId);
    const rooms = await tx.facRoom.findMany({ where: { hostelId: id, schoolId: user.schoolId }, orderBy: [{ floor: 'asc' }, { name: 'asc' }] });
    const beds = await tx.facBed.findMany({ where: { roomId: { in: rooms.map((r) => r.id) } } });
    const open = await tx.facBedAllocation.findMany({ where: { toDate: null, bedId: { in: beds.map((b) => b.id) } } });
    const students = await tx.student.findMany({ where: { id: { in: open.map((o) => o.studentId) } }, select: { id: true, fullName: true, admissionNumber: true, currentClass: { select: { name: true } } } });
    const names = await nameOf(tx, [h.boardingMasterId, h.matronId]);
    const collator = new Intl.Collator(undefined, { numeric: true });
    return {
      hostel: { id: h.id, name: h.name, gender: h.gender, capacity: h.capacity, active: h.active, boardingMaster: names.get(h.boardingMasterId ?? '') ?? null, matron: names.get(h.matronId ?? '') ?? null, boardingMasterId: h.boardingMasterId, matronId: h.matronId },
      rooms: rooms.map((r): RoomView => ({
        id: r.id, name: r.name, floor: r.floor, capacity: r.capacity, active: r.active,
        beds: beds.filter((b) => b.roomId === r.id).sort((a, b) => collator.compare(a.number, b.number)).map((b): BedView => {
          const a = open.find((o) => o.bedId === b.id);
          const s = students.find((x) => x.id === a?.studentId);
          return { id: b.id, number: b.number, bedType: b.bedType, locker: b.lockerNumber, active: b.active, studentId: s?.id ?? null, student: s?.fullName ?? null, admissionNumber: s?.admissionNumber ?? null, className: s?.currentClass?.name ?? null, since: a ? isoOf(a.fromDate) : null };
        }),
      })),
    };
  });
}

/** The room list to print: room, bed, learner, class and the primary guardian's phone. */
export async function roomList(user: Actor, hostelId: string) {
  need(user, 'facilities.hostel.view');
  need(user, 'students.guardians.view');
  const data = await getHostel(user, hostelId);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const ids = data.rooms.flatMap((r) => r.beds.map((b) => b.studentId)).filter((x): x is string => !!x);
    const links = await tx.studentGuardian.findMany({ where: { studentId: { in: ids }, isPrimary: true }, select: { studentId: true, guardian: { select: { fullName: true, phone: true } } } });
    return {
      hostel: data.hostel,
      rows: data.rooms.flatMap((r) => r.beds.filter((b) => b.studentId).map((b) => ({ room: r.name, bed: b.number, locker: b.locker, learner: b.student!, admissionNumber: b.admissionNumber!, className: b.className, guardian: links.find((l) => l.studentId === b.studentId)?.guardian.fullName ?? null, guardianPhone: links.find((l) => l.studentId === b.studentId)?.guardian.phone ?? null }))),
    };
  });
}

// ─── Allocation ──────────────────────────────────────────────────────────────

export const AllocateSchema = z.object({
  studentId: idSchema, bedId: idSchema,
  // A day scholar is changed to a boarder first; the boarding charge is added from today.
  changeToBoarder: z.boolean().optional(),
});

async function bedContext(tx: Db, schoolId: string, bedId: string) {
  const bed = await tx.facBed.findFirst({ where: { id: bedId, schoolId } });
  if (!bed) throw new ServiceError('Bed not found', 404);
  const room = await tx.facRoom.findUniqueOrThrow({ where: { id: bed.roomId } });
  const hostel = await tx.facHostel.findUniqueOrThrow({ where: { id: room.hostelId } });
  return { bed, room, hostel };
}

/** Allocates one learner to a bed, or moves them: the old allocation ends today and a new one starts, so the history of who slept where is kept. */
export async function allocateBed(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.allocate');
  const v = AllocateSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => allocateTx(tx, user, v.studentId, v.bedId, !!v.changeToBoarder));
}

async function allocateTx(tx: Db, user: Actor, studentId: string, bedId: string, changeToBoarder: boolean, termId?: string) {
  const { bed, room, hostel } = await bedContext(tx, user.schoolId, bedId);
  await within(tx, user, 'facilities.hostel.allocate', 'FacHostel', hostel.id);
  const s = await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true, gender: true, boarding: true, status: true } });
  if (!s) throw new ServiceError('Student not found', 404);
  if (s.status !== 'ACTIVE') throw new ServiceError(`${s.fullName} is not at the school`, 409);
  if (s.gender && s.gender !== hostel.gender) throw new ServiceError(`${hostel.name} is for ${hostel.gender === 'M' ? 'boys' : 'girls'}`, 409);
  if (!bed.active || !room.active || !hostel.active) throw new ServiceError('That bed, room or hostel is not in use', 409);
  const today = toDay(todayInHarare());
  let changed = false;
  if (s.boarding !== 'BOARDER') {
    if (!changeToBoarder) throw new ServiceError(`${s.fullName} is a day scholar. Only a boarder can be given a bed: change them to a boarder first. The boarding charge is added from today.`, 409);
    need(user, 'students.profiles.edit');
    await tx.student.update({ where: { id: s.id }, data: { boarding: 'BOARDER' } });
    await adjustForBoardingChange(tx, user, s.id, 'BOARDER', today);
    await audit(tx, user, 'UPDATE_STUDENT', 'Student', s.id, `${s.fullName}: changed to boarder to be given a bed in ${hostel.name}`, { boarding: 'DAY' }, { boarding: 'BOARDER' });
    changed = true;
  }
  const occupant = await tx.facBedAllocation.findFirst({ where: { bedId, toDate: null }, select: { studentId: true } });
  if (occupant && occupant.studentId === s.id) throw new ServiceError(`${s.fullName} is already in that bed`, 409);
  if (occupant) throw new ServiceError('That bed is taken. Choose another, or move the learner out first.', 409);
  const current = await tx.facBedAllocation.findFirst({ where: { studentId: s.id, toDate: null } });
  if (current) await tx.facBedAllocation.update({ where: { id: current.id }, data: { toDate: today, reason: 'Moved to another bed' } });
  const term = termId ?? (await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true } }))?.id ?? (await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true } }))?.id;
  if (!term) throw new ServiceError('The school has no term yet', 409);
  const a = await tx.facBedAllocation.create({ data: { schoolId: user.schoolId, studentId: s.id, bedId, termId: term, fromDate: today, allocatedById: user.id, reason: current ? 'Moved from another bed' : null } });
  await audit(tx, user, current ? 'FAC_MOVE_BED' : 'FAC_ALLOCATE_BED', 'FacBedAllocation', a.id, `${s.fullName}: ${current ? 'moved to' : 'given'} ${hostel.name}, ${room.name}, bed ${bed.number}`, current ? { allocationId: current.id, bedId: current.bedId } : undefined, { bedId, hostelId: hostel.id, roomId: room.id, changedToBoarder: changed } as never);
  return { allocationId: a.id, movedFrom: current?.bedId ?? null, changedToBoarder: changed };
}

export async function vacateBed(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.allocate');
  const v = z.object({ studentId: idSchema, reason: textSchema('the reason', 3, 200) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const a = await tx.facBedAllocation.findFirst({ where: { studentId: v.studentId, schoolId: user.schoolId, toDate: null } });
    if (!a) throw new ServiceError('That learner has no bed', 404);
    const { hostel } = await bedContext(tx, user.schoolId, a.bedId);
    await within(tx, user, 'facilities.hostel.allocate', 'FacHostel', hostel.id);
    await tx.facBedAllocation.update({ where: { id: a.id }, data: { toDate: toDay(todayInHarare()), reason: v.reason } });
    await audit(tx, user, 'FAC_MOVE_BED', 'FacBedAllocation', a.id, `Took a learner out of ${hostel.name}: ${v.reason}`, { bedId: a.bedId, toDate: null }, { toDate: todayInHarare(), reason: v.reason });
    return { allocationId: a.id };
  });
}

export const AutoSchema = z.object({
  hostelId: idSchema, levelId: idSchema.optional(), classId: idSchema.optional(), keepFormsTogether: z.boolean().default(true),
  // false = show the plan; true = make it.
  apply: z.boolean().default(false),
});

/** Allocates a whole intake: boarders of the hostel's gender with no bed, filtered by form or class, filling rooms in order. Show the plan first. */
export async function autoAllocate(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.allocate');
  const v = AutoSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, 'facilities.hostel.allocate', 'FacHostel', v.hostelId);
    const hostel = await tx.facHostel.findFirst({ where: { id: v.hostelId, schoolId: user.schoolId } });
    if (!hostel) throw new ServiceError('Hostel not found', 404);
    if (!hostel.active) throw new ServiceError('That hostel is not in use', 409);
    await vacateLeavers(tx, user.schoolId);
    const housed = (await tx.facBedAllocation.findMany({ where: { schoolId: user.schoolId, toDate: null }, select: { studentId: true } })).map((a) => a.studentId);
    const students = await tx.student.findMany({
      where: { schoolId: user.schoolId, status: 'ACTIVE', boarding: 'BOARDER', gender: hostel.gender, id: { notIn: housed }, ...(v.classId ? { currentClassId: v.classId } : {}), ...(v.levelId ? { currentClass: { levelId: v.levelId } } : {}) },
      select: { id: true, fullName: true, currentClassId: true, currentClass: { select: { name: true, level: { select: { order: true } } } } },
    });
    const rooms = await tx.facRoom.findMany({ where: { hostelId: hostel.id, active: true }, orderBy: { name: 'asc' } });
    const beds = await tx.facBed.findMany({ where: { roomId: { in: rooms.map((r) => r.id) }, active: true }, orderBy: { number: 'asc' } });
    const taken = new Set((await tx.facBedAllocation.findMany({ where: { toDate: null, bedId: { in: beds.map((b) => b.id) } }, select: { bedId: true } })).map((a) => a.bedId));
    const free: FreeRoom[] = rooms.map((r) => ({ roomId: r.id, name: r.name, floor: r.floor, free: beds.filter((b) => b.roomId === r.id && !taken.has(b.id)).map((b) => b.id) }));
    const candidates: Candidate[] = students.map((s) => ({ id: s.id, name: s.fullName, levelOrder: s.currentClass?.level.order ?? 99, classId: s.currentClassId, className: s.currentClass?.name ?? null }));
    const plan = planFill(candidates, free, v.keepFormsTogether);
    const label = (id: string) => students.find((s) => s.id === id)?.fullName ?? '';
    const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '';
    const bedNo = (id: string) => beds.find((b) => b.id === id)?.number ?? '';
    const preview = { candidates: candidates.length, freeBeds: free.reduce((n, r) => n + r.free.length, 0), placements: plan.placements.map((p) => ({ ...p, student: label(p.studentId), room: roomName(p.roomId), bed: bedNo(p.bedId) })), unplaced: plan.unplaced.map((id) => ({ studentId: id, student: label(id) })) };
    if (!v.apply) return { ...preview, applied: false };
    if (plan.placements.length === 0) throw new ServiceError('There is nobody to place, or no free bed', 409);
    const today = toDay(todayInHarare());
    const term = (await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true } }))?.id ?? (await tx.academicTerm.findFirst({ where: { schoolId: user.schoolId }, orderBy: { startDate: 'desc' }, select: { id: true } }))?.id;
    if (!term) throw new ServiceError('The school has no term yet', 409);
    await tx.facBedAllocation.createMany({ data: plan.placements.map((p) => ({ schoolId: user.schoolId, studentId: p.studentId, bedId: p.bedId, termId: term, fromDate: today, allocatedById: user.id })) });
    await audit(tx, user, 'FAC_ALLOCATE_BED', 'FacHostel', hostel.id, `Allocated ${plan.placements.length} boarders to ${hostel.name}${v.keepFormsTogether ? ' keeping forms together' : ''}; ${plan.unplaced.length} without a bed`, undefined, { placed: plan.placements.length, unplaced: plan.unplaced.length, levelId: v.levelId ?? null, classId: v.classId ?? null });
    return { ...preview, applied: true };
  });
}

export async function bedHistory(user: Actor, studentId: string) {
  viewer(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, heldKey(user), 'Student', studentId);
    const rows = await tx.facBedAllocation.findMany({ where: { schoolId: user.schoolId, studentId }, orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }] });
    const beds = await tx.facBed.findMany({ where: { id: { in: rows.map((r) => r.bedId) } } });
    const rooms = await tx.facRoom.findMany({ where: { id: { in: beds.map((b) => b.roomId) } } });
    const hostels = await tx.facHostel.findMany({ where: { id: { in: rooms.map((r) => r.hostelId) } } });
    const terms = await tx.academicTerm.findMany({ where: { id: { in: rows.map((r) => r.termId) } }, select: { id: true, name: true } });
    return rows.map((a) => {
      const b = beds.find((x) => x.id === a.bedId); const r = rooms.find((x) => x.id === b?.roomId); const h = hostels.find((x) => x.id === r?.hostelId);
      return { id: a.id, hostel: h?.name ?? '', room: r?.name ?? '', bed: b?.number ?? '', term: terms.find((t) => t.id === a.termId)?.name ?? '', from: isoOf(a.fromDate), to: a.toDate ? isoOf(a.toDate) : null, reason: a.reason };
    });
  });
}

// ─── Roll call ───────────────────────────────────────────────────────────────

export interface RollRow { studentId: string; name: string; admissionNumber: string; room: string; bed: string; status: FacRollStatus; locked: boolean; note: string | null }

async function hostelRoster(tx: Db, schoolId: string, hostelId: string) {
  const rooms = await tx.facRoom.findMany({ where: { hostelId, schoolId }, select: { id: true, name: true } });
  const beds = await tx.facBed.findMany({ where: { roomId: { in: rooms.map((r) => r.id) } }, select: { id: true, number: true, roomId: true } });
  const open = await tx.facBedAllocation.findMany({ where: { schoolId, toDate: null, bedId: { in: beds.map((b) => b.id) } } });
  const students = await tx.student.findMany({ where: { id: { in: open.map((o) => o.studentId) }, status: { in: ['ACTIVE', 'SUSPENDED'] } }, select: { id: true, fullName: true, admissionNumber: true }, orderBy: { fullName: 'asc' } });
  return students.map((s) => {
    const bed = beds.find((b) => b.id === open.find((o) => o.studentId === s.id)?.bedId);
    return { ...s, room: rooms.find((r) => r.id === bed?.roomId)?.name ?? '', bed: bed?.number ?? '' };
  });
}

const dateOk = (date: string) => { if (date > todayInHarare()) throw new ServiceError('A roll call cannot be taken for a day that has not come', 422); };

/** The sheet for one hostel, day and session: everyone Present, learners on exeat, in the sick bay or suspended filled in and locked, and anything already saved. */
export async function rollCallSheet(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.rollcall', 'facilities.hostel.view');
  const v = z.object({ hostelId: idSchema, date: isoDateSchema.optional(), session: z.enum(SESSIONS) }).parse(raw);
  const date = v.date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, can(user, 'facilities.hostel.rollcall') ? 'facilities.hostel.rollcall' : 'facilities.hostel.view', 'FacHostel', v.hostelId);
    const hostel = await tx.facHostel.findFirst({ where: { id: v.hostelId, schoolId: user.schoolId } });
    if (!hostel) throw new ServiceError('Hostel not found', 404);
    const settings = await loadFacSettings(tx, user.schoolId);
    const roster = await hostelRoster(tx, user.schoolId, hostel.id);
    const away = await awayStatus(tx, user.schoolId, roster.map((r) => r.id), new Date(), date);
    const saved = await tx.facRollCall.findFirst({ where: { schoolId: user.schoolId, hostelId: hostel.id, date: toDay(date), session: v.session as FacRollSession } });
    const entries = saved ? await tx.facRollCallEntry.findMany({ where: { rollCallId: saved.id } }) : [];
    return {
      hostel: { id: hostel.id, name: hostel.name }, date, session: v.session, sessions: settings.rollCallSessions, taken: saved ? { at: saved.takenAt.toISOString(), byId: saved.takenById } : null,
      rows: roster.map((r): RollRow => {
        const lock = away.get(r.id);
        const e = entries.find((x) => x.studentId === r.id);
        return { studentId: r.id, name: r.fullName, admissionNumber: r.admissionNumber, room: r.room, bed: r.bed, status: lock ?? e?.status ?? 'PRESENT', locked: !!lock, note: lock ? null : e?.note ?? null };
      }),
    };
  });
}

export const RollSchema = z.object({
  hostelId: idSchema, date: isoDateSchema, session: z.enum(SESSIONS),
  // From the offline queue: saving the same roll call twice changes nothing.
  clientId: z.string().trim().max(120).optional(),
  entries: z.array(z.object({ studentId: idSchema, status: z.enum(['PRESENT', 'ABSENT', 'LATE']), note: optText(200) })).max(1000),
});

/** Saves a roll call. Locked learners are forced to their reason; an unexplained Absent at lights out alerts the boarding master and the Deputy at once. */
export async function saveRollCall(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.rollcall');
  const v = RollSchema.parse(raw);
  dateOk(v.date);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, 'facilities.hostel.rollcall', 'FacHostel', v.hostelId);
    const hostel = await tx.facHostel.findFirst({ where: { id: v.hostelId, schoolId: user.schoolId } });
    if (!hostel) throw new ServiceError('Hostel not found', 404);
    const settings = await loadFacSettings(tx, user.schoolId);
    if (!settings.rollCallSessions.includes(v.session)) throw new ServiceError(`${SESSION_LABEL[v.session]} is not one of this school's roll calls`, 409);
    const roster = await hostelRoster(tx, user.schoolId, hostel.id);
    const ids = new Set(roster.map((r) => r.id));
    const given = new Map<string, (typeof v.entries)[number]>();
    for (const e of v.entries) {
      if (!ids.has(e.studentId)) throw new ServiceError('One of the learners does not sleep in this hostel', 422);
      if (given.has(e.studentId)) throw new ServiceError('A learner appears twice', 422);
      given.set(e.studentId, e);
    }
    const away = await awayStatus(tx, user.schoolId, roster.map((r) => r.id), new Date(), v.date);
    const rows = roster.map((r) => {
      const lock = away.get(r.id);
      const e = given.get(r.id);
      return { studentId: r.id, name: r.fullName, status: (lock ?? e?.status ?? 'PRESENT') as FacRollStatus, locked: !!lock, note: lock ? null : e?.note ?? null };
    });
    const existing = await tx.facRollCall.findFirst({ where: { schoolId: user.schoolId, hostelId: hostel.id, date: toDay(v.date), session: v.session as FacRollSession } });
    if (v.clientId && !existing && (await tx.facRollCall.findFirst({ where: { schoolId: user.schoolId, clientId: v.clientId }, select: { id: true } }))) return { id: null as string | null, outcome: 'duplicate' as const, absent: 0, late: 0, alerted: 0 };
    const call = existing
      ? await tx.facRollCall.update({ where: { id: existing.id }, data: { takenById: user.id, takenAt: new Date() } })
      : await tx.facRollCall.create({ data: { schoolId: user.schoolId, hostelId: hostel.id, date: toDay(v.date), session: v.session as FacRollSession, takenById: user.id, clientId: v.clientId ?? null } });
    const before = existing ? await tx.facRollCallEntry.findMany({ where: { rollCallId: call.id } }) : [];
    const alerted = new Set(before.filter((b) => b.alertedAt).map((b) => b.studentId));
    for (const r of rows) {
      await tx.facRollCallEntry.upsert({
        where: { rollCallId_studentId: { rollCallId: call.id, studentId: r.studentId } },
        update: { status: r.status, locked: r.locked, note: r.note },
        create: { schoolId: user.schoolId, rollCallId: call.id, studentId: r.studentId, status: r.status, locked: r.locked, note: r.note },
      });
    }
    // Unexplained Absent at lights out: tell the boarding master and the Deputy now. A learner already alerted for this roll call is not alerted twice.
    let alerts = 0;
    if (v.session === 'LIGHTS_OUT') {
      const missing = rows.filter((r) => r.status === 'ABSENT' && !r.note && !alerted.has(r.studentId));
      if (missing.length) {
        const people = Array.from(new Set([...(hostel.boardingMasterId ? [hostel.boardingMasterId] : []), ...(await deputyIds(tx, user.schoolId))]));
        await notifyUsers(tx, user.schoolId, people, {
          title: `Not in bed at lights out: ${missing.map((m) => m.name).slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}`, body: `${hostel.name}, ${v.date}. Absent without a reason.`, link: `/facilities/hostel/rollcall/${hostel.id}?session=LIGHTS_OUT`,
          dedupeKey: `lights-out:${call.id}:${missing.map((m) => m.studentId).sort().join(',').slice(0, 120)}`,
        });
        await tx.facRollCallEntry.updateMany({ where: { rollCallId: call.id, studentId: { in: missing.map((m) => m.studentId) } }, data: { alertedAt: new Date() } });
        alerts = missing.length;
      }
    }
    const absent = rows.filter((r) => r.status === 'ABSENT').length;
    const late = rows.filter((r) => r.status === 'LATE').length;
    await audit(tx, user, alerts ? 'FAC_ROLL_CALL_ALERT' : 'FAC_ROLL_CALL', 'FacRollCall', call.id, `${hostel.name}, ${v.date}, ${SESSION_LABEL[v.session]}: ${absent} absent, ${late} late, ${rows.filter((r) => r.locked).length} away${alerts ? `; ${alerts} unexplained at lights out reported` : ''}`,
      existing ? { absent: before.filter((b) => b.status === 'ABSENT').length } : undefined, { absent, late, away: rows.filter((r) => r.locked).length, alerts } as never);
    return { id: call.id as string | null, outcome: existing ? ('updated' as const) : ('created' as const), absent, late, alerted: alerts };
  });
}

/** Offline roll calls from a phone: each is saved on its own, so one refused roll call does not stop the rest. */
export async function syncRollCalls(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.rollcall');
  const { rollCalls } = z.object({ rollCalls: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }).parse(raw);
  const results: { ref: string | null; ok: boolean; outcome?: string; message?: string; status?: number }[] = [];
  for (const rc of rollCalls) {
    const ref = typeof rc.ref === 'string' ? rc.ref : null;
    try {
      const r = await saveRollCall(user, rc);
      results.push({ ref, ok: true, outcome: r.outcome });
    } catch (e) {
      const err = e as { status?: number; message?: string; name?: string };
      results.push({ ref, ok: false, status: err.name === 'ZodError' ? 422 : err.status ?? 500, message: err.name === 'ZodError' ? 'This roll call is not valid' : err.message });
    }
  }
  return { results };
}

export async function rollCallStatus(user: Actor, date?: string) {
  viewer(user);
  const day = date ?? todayInHarare();
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const hostels = (await reachable(tx, user, heldKey(user))).filter((h) => h.active);
    const calls = await tx.facRollCall.findMany({ where: { schoolId: user.schoolId, date: toDay(day), hostelId: { in: hostels.map((h) => h.id) } } });
    const entries = await tx.facRollCallEntry.groupBy({ by: ['rollCallId', 'status'], where: { rollCallId: { in: calls.map((c) => c.id) } }, _count: true });
    const settings = await loadFacSettings(tx, user.schoolId);
    return hostels.map((h) => ({
      hostelId: h.id, hostel: h.name,
      sessions: settings.rollCallSessions.map((s) => {
        const c = calls.find((x) => x.hostelId === h.id && x.session === s);
        const count = (st: string) => (c ? entries.filter((e) => e.rollCallId === c.id && e.status === st).reduce((n, e) => n + e._count, 0) : 0);
        return { session: s, taken: !!c, at: c?.takenAt.toISOString() ?? null, absent: count('ABSENT'), late: count('LATE') };
      }),
    }));
  });
}

// ─── Inspections ─────────────────────────────────────────────────────────────

export const InspectionSchema = z.object({
  hostelId: idSchema, roomId: idSchema, date: isoDateSchema.optional(), notes: optText(500), photoKeys: z.array(z.string().trim().max(200)).max(6).default([]),
  items: z.array(z.object({
    item: textSchema('the item', 2, 40), score: z.number().int().min(0).max(5), note: optText(200),
    // Damage that may be charged to the learner responsible, if the boarding master approves.
    damage: z.object({ studentId: idSchema, amountCents: centsSchema, currency: currencySchema }).optional(),
  })).min(1).max(12),
});

/** Scores a room against the checklist (cleanliness, beds made, lockers, damage); the room score is out of 100. Damage waits for the boarding master. */
export async function saveInspection(user: Actor, raw: unknown) {
  need(user, 'facilities.hostel.inspect');
  const v = InspectionSchema.parse(raw);
  for (const k of v.photoKeys) if (!proofKeyBelongsTo(k, user.schoolId)) throw new ServiceError('A photo does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    await within(tx, user, 'facilities.hostel.inspect', 'FacHostel', v.hostelId);
    const room = await tx.facRoom.findFirst({ where: { id: v.roomId, hostelId: v.hostelId, schoolId: user.schoolId } });
    if (!room) throw new ServiceError('Room not found', 404);
    const date = v.date ?? todayInHarare();
    if (date > todayInHarare()) throw new ServiceError('The inspection date cannot be in the future', 422);
    for (const i of v.items) if (i.damage && !(await tx.student.findFirst({ where: { id: i.damage.studentId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('The learner named for the damage was not found', 404);
    const score = Math.round((v.items.reduce((s, i) => s + i.score, 0) / (v.items.length * 5)) * 100);
    const ins = await tx.facInspection.create({ data: { schoolId: user.schoolId, hostelId: v.hostelId, roomId: v.roomId, date: toDay(date), inspectedById: user.id, score, notes: v.notes ?? null, photoKeys: v.photoKeys } });
    await tx.facInspectionItem.createMany({
      data: v.items.map((i) => ({
        schoolId: user.schoolId, inspectionId: ins.id, item: i.item, score: i.score, note: i.note ?? null,
        ...(i.damage ? { damageStudentId: i.damage.studentId, damageCents: i.damage.amountCents, damageCurrency: i.damage.currency, damageStatus: 'PENDING' as const } : {}),
      })),
    });
    const hostel = await tx.facHostel.findUniqueOrThrow({ where: { id: v.hostelId } });
    const damages = v.items.filter((i) => i.damage).length;
    await audit(tx, user, 'FAC_INSPECT_ROOM', 'FacInspection', ins.id, `Inspected ${hostel.name}, ${room.name}: ${score}/100${damages ? `, ${damages} damage item${damages === 1 ? '' : 's'} waiting for approval` : ''}`, undefined, { score, items: v.items.length, damages });
    if (damages && hostel.boardingMasterId && hostel.boardingMasterId !== user.id) {
      await notifyUsers(tx, user.schoolId, [hostel.boardingMasterId], { title: `Damage to approve in ${room.name}`, body: `${damages} item${damages === 1 ? '' : 's'}`, link: '/facilities/hostel/inspections' });
    }
    return { id: ins.id, score };
  });
}

export async function decideDamage(user: Actor, itemId: string, raw: unknown) {
  need(user, 'facilities.hostel.manage');
  const v = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: optText(300) }).parse(raw);
  if (v.decision === 'REJECT' && (v.reason ?? '').trim().length < 3) throw new ServiceError('Say why the damage is not charged', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const item = await tx.facInspectionItem.findFirst({ where: { id: itemId, schoolId: user.schoolId } });
    if (!item || item.damageStatus === null) throw new ServiceError('Damage item not found', 404);
    const ins = await tx.facInspection.findUniqueOrThrow({ where: { id: item.inspectionId } });
    await within(tx, user, 'facilities.hostel.manage', 'FacHostel', ins.hostelId);
    if (item.damageStatus !== 'PENDING') throw new ServiceError('This was already decided', 409);
    if (v.decision === 'REJECT') {
      await tx.facInspectionItem.update({ where: { id: item.id }, data: { damageStatus: 'REJECTED', damageApprovedById: user.id, note: [item.note, `Not charged: ${v.reason}`].filter(Boolean).join('. ') } });
      await audit(tx, user, 'FAC_DECIDE_DAMAGE', 'FacInspectionItem', item.id, `Damage not charged: ${v.reason}`, { damageStatus: 'PENDING' }, { damageStatus: 'REJECTED', reason: v.reason ?? null });
      return { status: 'REJECTED' as const };
    }
    const room = await tx.facRoom.findUniqueOrThrow({ where: { id: ins.roomId } });
    const c = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: item.damageStudentId!, part: 'HOSTEL', kind: 'DAMAGE', description: `Damage in ${room.name}: ${item.item}${item.note ? ` (${item.note})` : ''}`, currency: item.damageCurrency as Cur, amountCents: item.damageCents!, sourceType: 'FacInspectionItem', sourceId: item.id });
    await tx.facInspectionItem.update({ where: { id: item.id }, data: { damageStatus: 'APPROVED', damageApprovedById: user.id, damageChargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId } });
    await audit(tx, user, 'FAC_DECIDE_DAMAGE', 'FacInspectionItem', item.id, `Damage charged to a learner: ${item.damageCents} cents ${item.damageCurrency}`, { damageStatus: 'PENDING' }, { damageStatus: 'APPROVED', charge: c.where, chargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId } as never);
    return { status: 'APPROVED' as const, charged: c.where };
  });
}

export async function listInspections(user: Actor, f: { hostelId?: string } = {}) {
  need(user, 'facilities.hostel.inspect', 'facilities.hostel.manage', 'facilities.hostel.view');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const hostels = await reachable(tx, user, heldKey(user));
    const ids = hostels.map((h) => h.id).filter((id) => !f.hostelId || id === f.hostelId);
    const rows = await tx.facInspection.findMany({ where: { schoolId: user.schoolId, hostelId: { in: ids } }, orderBy: { date: 'desc' }, take: 60 });
    const items = await tx.facInspectionItem.findMany({ where: { inspectionId: { in: rows.map((r) => r.id) } } });
    const rooms = await tx.facRoom.findMany({ where: { id: { in: rows.map((r) => r.roomId) } }, select: { id: true, name: true } });
    const stu = await tx.student.findMany({ where: { id: { in: items.map((i) => i.damageStudentId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const people = await nameOf(tx, rows.map((r) => r.inspectedById));
    return rows.map((r) => ({
      id: r.id, hostel: hostels.find((h) => h.id === r.hostelId)?.name ?? '', room: rooms.find((x) => x.id === r.roomId)?.name ?? '', date: isoOf(r.date), score: r.score, notes: r.notes, inspector: people.get(r.inspectedById) ?? '', photos: r.photoKeys.length,
      items: items.filter((i) => i.inspectionId === r.id).map((i) => ({ id: i.id, item: i.item, score: i.score, note: i.note, damageStatus: i.damageStatus, damageCents: i.damageCents, damageCurrency: i.damageCurrency as Cur | null, learner: stu.find((s) => s.id === i.damageStudentId)?.fullName ?? null })),
    }));
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function hostelDashboard(user: Actor) {
  viewer(user);
  const cards = await listHostels(user);
  const status = await rollCallStatus(user);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const now = new Date();
    const housed = (await tx.facBedAllocation.findMany({ where: { schoolId: user.schoolId, toDate: null }, select: { studentId: true, bedId: true } }));
    const mineBeds = new Set((await Promise.all(cards.map((c) => bedIdsOf(tx, user.schoolId, c.id)))).flat());
    const mine = housed.filter((h) => mineBeds.has(h.bedId)).map((h) => h.studentId);
    const [out, sick] = await Promise.all([
      tx.facExeat.findMany({ where: { schoolId: user.schoolId, studentId: { in: mine }, status: 'SIGNED_OUT' }, select: { studentId: true, dueBackAt: true } }),
      tx.facSickBayVisit.count({ where: { schoolId: user.schoolId, studentId: { in: mine }, admittedAt: { not: null }, dischargedAt: null } }),
    ]);
    return {
      hostels: cards.filter((c) => c.active),
      beds: { total: cards.reduce((n, c) => n + c.beds, 0), filled: cards.reduce((n, c) => n + c.filled, 0), capacity: cards.reduce((n, c) => n + c.capacity, 0) },
      rollCalls: status, onExeat: out.length, inSickBay: sick, overdueReturns: out.filter((o) => o.dueBackAt < now).length,
    };
  });
}
