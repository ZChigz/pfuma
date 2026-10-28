// Transport: routes and stops, vehicles and drivers with their papers, learners on routes (charged each term, prorated from the day they
// join when the school says so), daily trips, fuel (an expense in Finance), and vehicle bookings for school trips.
//
// A trip cannot be recorded for a vehicle or a driver whose papers have run out; a route never carries more learners than its vehicle has
// seats; a vehicle or driver is never double-booked. The database holds those rules as well.
import { z } from 'zod';
import type { FacTripLeg, FacVehicleDocType, FacDriverDocType } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import * as guards from '@/lib/access/guards';
import { proofKeyBelongsTo } from '@/lib/proof-of-payment';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds } from '@/lib/students/common';
import {
  addDays, audit, centsSchema, currencySchema, formatMoney, idSchema, isoDateSchema, isoOf, loadFacSettings, need, optText, textSchema, todayInHarare, toDay, type Actor, type Cur,
} from '@/lib/facilities/common';
import { chargeLearner, chargeTermId, recordFacilityExpense } from '@/lib/facilities/money';

const VIEW = ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'] as const;
const DAY = 86_400_000;
export const VEHICLE_DOCS = ['LICENCE', 'INSURANCE', 'FITNESS', 'ROUTE_PERMIT'] as const;
export const DRIVER_DOCS = ['DRIVING_LICENCE', 'DEFENSIVE_DRIVING'] as const;
export const DOC_LABEL: Record<string, string> = { LICENCE: 'Vehicle licence', INSURANCE: 'Insurance', FITNESS: 'Certificate of fitness', ROUTE_PERMIT: 'Route permit', DRIVING_LICENCE: 'Driving licence', DEFENSIVE_DRIVING: 'Defensive driving certificate' };
const hm = z.string().trim().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time as HH:MM').nullable().optional();

// ─── Papers ──────────────────────────────────────────────────────────────────

export interface PaperStatus { type: string; label: string; expiry: string | null; state: 'OK' | 'SOON' | 'EXPIRED' | 'MISSING'; required: boolean }

/** The newest paper of each kind decides: out of date blocks trips; a missing required paper blocks them too. */
export function paperStatus(docs: { type: string; expiry: Date }[], types: readonly string[], required: readonly string[], today: string, warnDays = 30): PaperStatus[] {
  return types.map((type) => {
    const latest = docs.filter((d) => d.type === type).sort((a, b) => b.expiry.getTime() - a.expiry.getTime())[0];
    const req = required.includes(type);
    if (!latest) return { type, label: DOC_LABEL[type] ?? type, expiry: null, state: req ? 'MISSING' : 'OK', required: req };
    const exp = isoOf(latest.expiry);
    const left = Math.round((latest.expiry.getTime() - toDay(today).getTime()) / DAY);
    return { type, label: DOC_LABEL[type] ?? type, expiry: exp, state: left < 0 ? 'EXPIRED' : left <= warnDays ? 'SOON' : 'OK', required: req };
  });
}
const blocked = (s: PaperStatus[]) => s.some((p) => p.state === 'EXPIRED' || p.state === 'MISSING');

// ─── Vehicles and drivers ────────────────────────────────────────────────────

export const VehicleSchema = z.object({
  id: idSchema.optional(), registration: textSchema('the registration', 3, 20), make: textSchema('the make', 2, 40), model: optText(40), seats: z.number().int().min(1).max(120),
  owner: z.enum(['SCHOOL', 'HIRED']).default('SCHOOL'), odometerKm: z.number().int().min(0).max(5_000_000).default(0), active: z.boolean().optional(), assetId: idSchema.nullable().optional(),
});

export async function saveVehicle(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = VehicleSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const reg = v.registration.toUpperCase();
    if (v.assetId && !(await tx.facAsset.findFirst({ where: { id: v.assetId, schoolId: user.schoolId }, select: { id: true } }))) throw new ServiceError('Asset not found', 404);
    const clash = await tx.facVehicle.findFirst({ where: { schoolId: user.schoolId, registration: reg, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } });
    if (clash) throw new ServiceError(`${reg} is already on the list`, 409);
    if (v.id) {
      const before = await tx.facVehicle.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
      if (!before) throw new ServiceError('Vehicle not found', 404);
      if (v.odometerKm < before.odometerKm) throw new ServiceError('The odometer cannot go back', 422);
      const row = await tx.facVehicle.update({ where: { id: v.id }, data: { registration: reg, make: v.make, model: v.model ?? null, seats: v.seats, owner: v.owner, odometerKm: v.odometerKm, active: v.active ?? before.active, assetId: v.assetId ?? before.assetId } });
      await audit(tx, user, 'FAC_VEHICLE_SAVE', 'FacVehicle', row.id, `Vehicle ${reg} changed`, { seats: before.seats, active: before.active }, { seats: row.seats, active: row.active });
      return { id: row.id };
    }
    const row = await tx.facVehicle.create({ data: { schoolId: user.schoolId, registration: reg, make: v.make, model: v.model ?? null, seats: v.seats, owner: v.owner, odometerKm: v.odometerKm, assetId: v.assetId ?? null } });
    await audit(tx, user, 'FAC_VEHICLE_SAVE', 'FacVehicle', row.id, `Vehicle ${reg} added (${v.seats} seats)`, undefined, { seats: v.seats, owner: v.owner });
    return { id: row.id };
  });
}

export const DocSchema = z.object({ type: z.enum([...VEHICLE_DOCS, ...DRIVER_DOCS]), number: optText(60), expiry: isoDateSchema, fileKey: optText(200) });

/** A renewed paper is a new row; the old one stays as history. */
export async function addVehicleDoc(user: Actor, vehicleId: string, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = DocSchema.parse(raw);
  if (!(VEHICLE_DOCS as readonly string[]).includes(v.type)) throw new ServiceError('That is not a vehicle paper', 422);
  if (v.fileKey && !proofKeyBelongsTo(v.fileKey, user.schoolId)) throw new ServiceError('That file does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const veh = await tx.facVehicle.findFirst({ where: { id: vehicleId, schoolId: user.schoolId } });
    if (!veh) throw new ServiceError('Vehicle not found', 404);
    const row = await tx.facVehicleDocument.create({ data: { schoolId: user.schoolId, vehicleId, type: v.type as FacVehicleDocType, number: v.number ?? null, expiry: toDay(v.expiry), fileKey: v.fileKey ?? null } });
    await audit(tx, user, 'FAC_VEHICLE_SAVE', 'FacVehicleDocument', row.id, `${veh.registration}: ${DOC_LABEL[v.type]} valid to ${v.expiry}`, undefined, { type: v.type, expiry: v.expiry });
    return { id: row.id };
  });
}

export const DriverSchema = z.object({ id: idSchema.optional(), employeeId: idSchema, licenceClass: textSchema('the licence class', 1, 20), licenceNumber: optText(40), phone: optText(20), active: z.boolean().optional() });

export async function saveDriver(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = DriverSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const emp = await tx.employee.findFirst({ where: { id: v.employeeId, schoolId: user.schoolId }, select: { id: true, firstName: true, surname: true } });
    if (!emp) throw new ServiceError('Employee not found', 404);
    const existing = await tx.facDriver.findUnique({ where: { schoolId_employeeId: { schoolId: user.schoolId, employeeId: emp.id } } });
    if (existing && existing.id !== v.id) throw new ServiceError(`${emp.firstName} ${emp.surname} is already a driver`, 409);
    if (v.id || existing) {
      const id = (v.id ?? existing!.id);
      const row = await tx.facDriver.update({ where: { id }, data: { licenceClass: v.licenceClass, licenceNumber: v.licenceNumber ?? null, phone: v.phone ?? null, active: v.active ?? true } });
      await audit(tx, user, 'FAC_DRIVER_SAVE', 'FacDriver', row.id, `Driver ${emp.firstName} ${emp.surname} changed`, undefined, { licenceClass: v.licenceClass });
      return { id: row.id };
    }
    const row = await tx.facDriver.create({ data: { schoolId: user.schoolId, employeeId: emp.id, licenceClass: v.licenceClass, licenceNumber: v.licenceNumber ?? null, phone: v.phone ?? null } });
    await audit(tx, user, 'FAC_DRIVER_SAVE', 'FacDriver', row.id, `Driver ${emp.firstName} ${emp.surname} added`, undefined, { licenceClass: v.licenceClass });
    return { id: row.id };
  });
}

export async function addDriverDoc(user: Actor, driverId: string, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = DocSchema.parse(raw);
  if (!(DRIVER_DOCS as readonly string[]).includes(v.type)) throw new ServiceError('That is not a driver paper', 422);
  if (v.fileKey && !proofKeyBelongsTo(v.fileKey, user.schoolId)) throw new ServiceError('That file does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const d = await tx.facDriver.findFirst({ where: { id: driverId, schoolId: user.schoolId } });
    if (!d) throw new ServiceError('Driver not found', 404);
    const row = await tx.facDriverDocument.create({ data: { schoolId: user.schoolId, driverId, type: v.type as FacDriverDocType, number: v.number ?? null, expiry: toDay(v.expiry), fileKey: v.fileKey ?? null } });
    await audit(tx, user, 'FAC_VEHICLE_SAVE', 'FacDriverDocument', row.id, `Driver paper: ${DOC_LABEL[v.type]} valid to ${v.expiry}`, undefined, { type: v.type, expiry: v.expiry });
    return { id: row.id };
  });
}

export async function fleet(user: Actor) {
  need(user, ...VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const today = todayInHarare();
    const [vehicles, vdocs, drivers, ddocs] = await Promise.all([
      tx.facVehicle.findMany({ where: { schoolId: user.schoolId }, orderBy: { registration: 'asc' } }), tx.facVehicleDocument.findMany({ where: { schoolId: user.schoolId } }),
      tx.facDriver.findMany({ where: { schoolId: user.schoolId } }), tx.facDriverDocument.findMany({ where: { schoolId: user.schoolId } }),
    ]);
    const emps = await tx.employee.findMany({ where: { id: { in: drivers.map((d) => d.employeeId) } }, select: { id: true, firstName: true, surname: true } });
    return {
      vehicles: vehicles.map((v) => { const papers = paperStatus(vdocs.filter((d) => d.vehicleId === v.id), VEHICLE_DOCS, ['LICENCE', 'INSURANCE', 'FITNESS'], today); return { id: v.id, registration: v.registration, make: v.make, model: v.model, seats: v.seats, owner: v.owner, odometerKm: v.odometerKm, active: v.active, papers, blocked: blocked(papers) }; }),
      drivers: drivers.map((d) => { const e = emps.find((x) => x.id === d.employeeId); const papers = paperStatus(ddocs.filter((x) => x.driverId === d.id), DRIVER_DOCS, ['DRIVING_LICENCE'], today); return { id: d.id, employeeId: d.employeeId, name: e ? `${e.firstName} ${e.surname}` : '', licenceClass: d.licenceClass, phone: d.phone, active: d.active, papers, blocked: blocked(papers) }; }),
    };
  });
}

// ─── Routes and stops ────────────────────────────────────────────────────────

export const RouteSchema = z.object({
  id: idSchema.optional(), name: textSchema('the route name', 2, 60), zone: optText(60), amTime: hm, pmTime: hm, vehicleId: idSchema.nullable().optional(), driverId: idSchema.nullable().optional(),
  feeCents: centsSchema.or(z.literal(0)), currency: currencySchema.default('USD'), active: z.boolean().optional(),
});

export async function saveRoute(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = RouteSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    if (v.vehicleId && !(await tx.facVehicle.findFirst({ where: { id: v.vehicleId, schoolId: user.schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Vehicle not found', 404);
    if (v.driverId && !(await tx.facDriver.findFirst({ where: { id: v.driverId, schoolId: user.schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Driver not found', 404);
    const clash = await tx.facRoute.findFirst({ where: { schoolId: user.schoolId, name: v.name, ...(v.id ? { id: { not: v.id } } : {}) }, select: { id: true } });
    if (clash) throw new ServiceError(`There is already a route called ${v.name}`, 409);
    const data = { name: v.name, zone: v.zone ?? null, amTime: v.amTime ?? null, pmTime: v.pmTime ?? null, vehicleId: v.vehicleId ?? null, driverId: v.driverId ?? null, feeCents: v.feeCents, currency: v.currency };
    if (v.id) {
      const before = await tx.facRoute.findFirst({ where: { id: v.id, schoolId: user.schoolId } });
      if (!before) throw new ServiceError('Route not found', 404);
      if (data.vehicleId) {
        const seats = (await tx.facVehicle.findUniqueOrThrow({ where: { id: data.vehicleId }, select: { seats: true } })).seats;
        const on = await tx.facStudentRoute.count({ where: { routeId: v.id, removedAt: null } });
        if (on > seats) throw new ServiceError(`${on} learners are on this route and that vehicle has ${seats} seats`, 409);
      }
      const row = await tx.facRoute.update({ where: { id: v.id }, data: { ...data, active: v.active ?? before.active } });
      await audit(tx, user, 'FAC_ROUTE_SAVE', 'FacRoute', row.id, `Route ${row.name} changed`, { feeCents: before.feeCents, vehicleId: before.vehicleId, driverId: before.driverId }, { feeCents: row.feeCents, vehicleId: row.vehicleId, driverId: row.driverId });
      return { id: row.id };
    }
    const row = await tx.facRoute.create({ data: { schoolId: user.schoolId, ...data } });
    await audit(tx, user, 'FAC_ROUTE_SAVE', 'FacRoute', row.id, `Route ${row.name} added`, undefined, { feeCents: row.feeCents, currency: row.currency });
    return { id: row.id };
  });
}

export const StopSchema = z.object({ id: idSchema.optional(), routeId: idSchema, name: textSchema('the stop', 2, 80), sequence: z.number().int().min(1).max(200), amPickupTime: hm, pmDropTime: hm });

export async function saveStop(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = StopSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const route = await tx.facRoute.findFirst({ where: { id: v.routeId, schoolId: user.schoolId } });
    if (!route) throw new ServiceError('Route not found', 404);
    const clash = await tx.facStop.findFirst({ where: { routeId: v.routeId, sequence: v.sequence, ...(v.id ? { id: { not: v.id } } : {}) } });
    if (clash) throw new ServiceError(`Stop ${v.sequence} on ${route.name} is already ${clash.name}`, 409);
    const data = { name: v.name, sequence: v.sequence, amPickupTime: v.amPickupTime ?? null, pmDropTime: v.pmDropTime ?? null };
    if (v.id) {
      const before = await tx.facStop.findFirst({ where: { id: v.id, schoolId: user.schoolId, routeId: v.routeId } });
      if (!before) throw new ServiceError('Stop not found', 404);
      await tx.facStop.update({ where: { id: v.id }, data });
      await audit(tx, user, 'FAC_ROUTE_SAVE', 'FacStop', v.id, `${route.name}: stop ${v.sequence} changed`, { name: before.name }, { name: v.name });
      return { id: v.id };
    }
    const row = await tx.facStop.create({ data: { schoolId: user.schoolId, routeId: v.routeId, ...data } });
    await audit(tx, user, 'FAC_ROUTE_SAVE', 'FacStop', row.id, `${route.name}: stop ${v.sequence} ${v.name} added`, undefined, data);
    return { id: row.id };
  });
}

export async function listRoutes(user: Actor) {
  need(user, ...VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await chargeTermId(tx, user.schoolId);
    const [routes, stops, vehicles, drivers, learners] = await Promise.all([
      tx.facRoute.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } }), tx.facStop.findMany({ where: { schoolId: user.schoolId }, orderBy: { sequence: 'asc' } }),
      tx.facVehicle.findMany({ where: { schoolId: user.schoolId } }), tx.facDriver.findMany({ where: { schoolId: user.schoolId } }),
      tx.facStudentRoute.groupBy({ by: ['routeId'], where: { schoolId: user.schoolId, removedAt: null, ...(term ? { termId: term } : {}) }, _count: { _all: true } }),
    ]);
    const emps = await tx.employee.findMany({ where: { id: { in: drivers.map((d) => d.employeeId) } }, select: { id: true, firstName: true, surname: true } });
    return routes.map((r) => {
      const veh = vehicles.find((x) => x.id === r.vehicleId); const drv = drivers.find((x) => x.id === r.driverId); const e = emps.find((x) => x.id === drv?.employeeId);
      return {
        id: r.id, name: r.name, zone: r.zone, amTime: r.amTime, pmTime: r.pmTime, feeCents: r.feeCents, currency: r.currency as Cur, active: r.active, vehicleId: r.vehicleId, driverId: r.driverId,
        vehicle: veh ? `${veh.registration} (${veh.seats} seats)` : null, seats: veh?.seats ?? null, driver: e ? `${e.firstName} ${e.surname}` : null, learners: learners.find((l) => l.routeId === r.id)?._count._all ?? 0,
        stops: stops.filter((s) => s.routeId === r.id).map((s) => ({ id: s.id, name: s.name, sequence: s.sequence, amPickupTime: s.amPickupTime, pmDropTime: s.pmDropTime })),
      };
    });
  });
}

// ─── Learners on routes ──────────────────────────────────────────────────────

export const AssignSchema = z.object({ studentId: idSchema, routeId: idSchema, amStopId: idSchema, pmStopId: idSchema.optional(), fromDate: isoDateSchema.optional() });

/** The part of a term's fee a learner owes from a start date: the days left over the days in the term. */
export function proratedFee(feeCents: number, termStart: string, termEnd: string, from: string): number {
  const start = toDay(termStart).getTime(); const end = toDay(termEnd).getTime(); const f = Math.min(Math.max(toDay(from).getTime(), start), end);
  const total = Math.round((end - start) / DAY) + 1; const left = Math.round((end - f) / DAY) + 1;
  return Math.max(0, Math.round((feeCents * left) / total));
}

/** Puts a learner on a route for the term and raises the transport charge (prorated from the day they join when the school says so). */
export async function assignLearner(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.assign');
  const v = AssignSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { id: v.studentId, schoolId: user.schoolId, status: 'ACTIVE' }, select: { id: true, fullName: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    const route = await tx.facRoute.findFirst({ where: { id: v.routeId, schoolId: user.schoolId } });
    if (!route) throw new ServiceError('Route not found', 404);
    if (!route.active) throw new ServiceError(`${route.name} is not running`, 409);
    const pm = v.pmStopId ?? v.amStopId;
    const stops = await tx.facStop.findMany({ where: { id: { in: [v.amStopId, pm] }, routeId: route.id, schoolId: user.schoolId } });
    if (!stops.some((x) => x.id === v.amStopId) || !stops.some((x) => x.id === pm)) throw new ServiceError('Choose stops on this route', 422);
    const termId = await chargeTermId(tx, user.schoolId);
    if (!termId) throw new ServiceError('The school has no term to put the learner on the route for', 409);
    const term = await tx.academicTerm.findUniqueOrThrow({ where: { id: termId } });
    const today = todayInHarare();
    const from = v.fromDate ?? (isoOf(term.startDate) > today ? isoOf(term.startDate) : today);
    const existing = await tx.facStudentRoute.findUnique({ where: { studentId_termId: { studentId: s.id, termId } } });
    if (existing && !existing.removedAt) throw new ServiceError(`${s.fullName} is already on a route this term. Remove them first to change route.`, 409);
    if (route.vehicleId) {
      const seats = (await tx.facVehicle.findUniqueOrThrow({ where: { id: route.vehicleId }, select: { seats: true } })).seats;
      const taken = await tx.facStudentRoute.count({ where: { routeId: route.id, removedAt: null, id: { not: existing?.id ?? '' } } });
      if (taken + 1 > seats) throw new ServiceError(`The vehicle on ${route.name} has ${seats} seats and all are taken`, 409);
    }
    const settings = await loadFacSettings(tx, user.schoolId);
    let amount = route.feeCents;
    if (settings.prorateTransport) amount = proratedFee(route.feeCents, isoOf(term.startDate), isoOf(term.endDate), from);
    // Coming back to the same route in the same term is not charged twice.
    const sameAgain = existing?.routeId === route.id && !!existing.chargeId;
    let charge: { chargeId: string | null; ledgerEntryId: string | null } = { chargeId: null, ledgerEntryId: null };
    const id = existing?.id ?? undefined;
    const rowData = { amStopId: v.amStopId, pmStopId: pm, routeId: route.id, fromDate: toDay(from), removedAt: null };
    const row = existing
      ? await tx.facStudentRoute.update({ where: { id: existing.id }, data: rowData })
      : await tx.facStudentRoute.create({ data: { schoolId: user.schoolId, studentId: s.id, termId, ...rowData } });
    if (amount > 0 && !sameAgain) {
      const c = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: s.id, part: 'TRANSPORT', kind: 'TRANSPORT', description: `Transport: ${route.name}${settings.prorateTransport && amount !== route.feeCents ? ` (from ${from})` : ''}`, currency: route.currency as Cur, amountCents: amount, sourceType: 'FacStudentRoute', sourceId: row.id });
      charge = { chargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId };
      await tx.facStudentRoute.update({ where: { id: row.id }, data: { chargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId } });
    }
    void id;
    await audit(tx, user, 'FAC_ROUTE_ASSIGN', 'FacStudentRoute', row.id, `${s.fullName} put on ${route.name}${amount > 0 && !sameAgain ? `, charged ${formatMoney(amount, route.currency as Cur)}` : ''}`, undefined, { routeId: route.id, termId, amountCents: sameAgain ? 0 : amount, from, ...charge } as never);
    return { id: row.id, chargedCents: sameAgain ? 0 : amount, ...charge };
  });
}

/** Takes a learner off the route: no further term is charged; the row and the past charge stay. */
export async function removeLearner(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.assign');
  const { studentId, reason } = z.object({ studentId: idSchema, reason: textSchema('the reason', 3, 200) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const s = await tx.student.findFirst({ where: { id: studentId, schoolId: user.schoolId }, select: { id: true, fullName: true } });
    if (!s) throw new ServiceError('Student not found', 404);
    const row = await tx.facStudentRoute.findFirst({ where: { studentId, schoolId: user.schoolId, removedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!row) throw new ServiceError(`${s.fullName} is not on a route`, 409);
    await tx.facStudentRoute.update({ where: { id: row.id }, data: { removedAt: new Date() } });
    await audit(tx, user, 'FAC_ROUTE_ASSIGN', 'FacStudentRoute', row.id, `${s.fullName} taken off their route: ${reason}`, { removedAt: null }, { removedAt: new Date().toISOString(), reason });
    return { id: row.id };
  });
}

export async function routeLearners(user: Actor, routeId: string) {
  need(user, ...VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const route = await tx.facRoute.findFirst({ where: { id: routeId, schoolId: user.schoolId } });
    if (!route) throw new ServiceError('Route not found', 404);
    const rows = await tx.facStudentRoute.findMany({ where: { routeId, schoolId: user.schoolId, removedAt: null } });
    const students = await tx.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, fullName: true, admissionNumber: true } });
    const stops = await tx.facStop.findMany({ where: { routeId }, select: { id: true, name: true } });
    return rows.map((r) => ({ studentId: r.studentId, name: students.find((s) => s.id === r.studentId)?.fullName ?? '', admissionNumber: students.find((s) => s.id === r.studentId)?.admissionNumber ?? '', amStop: stops.find((s) => s.id === r.amStopId)?.name ?? '', pmStop: stops.find((s) => s.id === r.pmStopId)?.name ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

// ─── Trips and fuel ──────────────────────────────────────────────────────────

export const TripSchema = z.object({
  routeId: idSchema.optional(), bookingId: idSchema.optional(), vehicleId: idSchema.optional(), driverId: idSchema.optional(), date: isoDateSchema.optional(), leg: z.enum(['MORNING', 'AFTERNOON', 'OTHER']).default('MORNING'),
  odometerStart: z.number().int().min(0).max(5_000_000).optional(), odometerEnd: z.number().int().min(0).max(5_000_000).optional(),
  departedAt: z.coerce.date().optional(), arrivedAt: z.coerce.date().optional(), boardedStudentIds: z.array(idSchema).max(120).default([]),
}).refine((v) => !!v.routeId !== !!v.bookingId, { message: 'A trip is on a route or for a booking', path: ['routeId'] });

/** Records a trip. An out-of-date licence, insurance, fitness paper or driver's licence refuses it (here and in the database). */
export async function recordTrip(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.trips');
  const v = TripSchema.parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const date = v.date ?? todayInHarare();
    if (date > todayInHarare()) throw new ServiceError('A trip cannot be recorded for a future day', 422);
    let vehicleId = v.vehicleId; let driverId = v.driverId;
    let learners: string[] = [];
    if (v.routeId) {
      const route = await tx.facRoute.findFirst({ where: { id: v.routeId, schoolId: user.schoolId } });
      if (!route) throw new ServiceError('Route not found', 404);
      vehicleId = vehicleId ?? route.vehicleId ?? undefined; driverId = driverId ?? route.driverId ?? undefined;
      learners = (await tx.facStudentRoute.findMany({ where: { routeId: route.id, schoolId: user.schoolId, removedAt: null }, select: { studentId: true } })).map((l) => l.studentId);
    } else {
      const b = await tx.facVehicleBooking.findFirst({ where: { id: v.bookingId!, schoolId: user.schoolId } });
      if (!b) throw new ServiceError('Booking not found', 404);
      if (b.status !== 'APPROVED') throw new ServiceError('That booking is not approved', 409);
      vehicleId = vehicleId ?? b.vehicleId; driverId = driverId ?? b.driverId ?? undefined;
      learners = (await tx.facTripPassenger.findMany({ where: { bookingId: b.id, schoolId: user.schoolId }, select: { studentId: true } })).map((l) => l.studentId);
    }
    if (!vehicleId || !driverId) throw new ServiceError('Choose the vehicle and the driver', 422);
    const veh = await tx.facVehicle.findFirst({ where: { id: vehicleId, schoolId: user.schoolId } });
    const drv = await tx.facDriver.findFirst({ where: { id: driverId, schoolId: user.schoolId } });
    if (!veh || !drv) throw new ServiceError('Vehicle or driver not found', 404);
    if (!veh.active || !drv.active) throw new ServiceError('That vehicle or driver is not in use', 409);
    const [vdocs, ddocs] = await Promise.all([tx.facVehicleDocument.findMany({ where: { vehicleId } }), tx.facDriverDocument.findMany({ where: { driverId } })]);
    const bad = [...paperStatus(vdocs, VEHICLE_DOCS, ['LICENCE', 'INSURANCE', 'FITNESS'], date), ...paperStatus(ddocs, DRIVER_DOCS, ['DRIVING_LICENCE'], date)].filter((p) => p.state === 'EXPIRED' || p.state === 'MISSING');
    if (bad.length) throw new ServiceError(`No trip can be recorded: ${bad.map((p) => (p.state === 'MISSING' ? `no ${p.label.toLowerCase()} on record` : `the ${p.label.toLowerCase()} ran out on ${p.expiry}`)).join('; ')}`, 409);
    if (v.odometerStart !== undefined && v.odometerEnd !== undefined && v.odometerEnd < v.odometerStart) throw new ServiceError('The odometer at the end is less than at the start', 422);
    const allowed = new Set(learners);
    for (const id of v.boardedStudentIds) if (!allowed.has(id)) throw new ServiceError('A learner who boarded is not on this route or booking', 422);
    const trip = await tx.facTrip.create({
      data: { schoolId: user.schoolId, routeId: v.routeId ?? null, bookingId: v.bookingId ?? null, vehicleId, driverId, date: toDay(date), leg: v.leg as FacTripLeg, odometerStart: v.odometerStart ?? null, odometerEnd: v.odometerEnd ?? null, departedAt: v.departedAt ?? null, arrivedAt: v.arrivedAt ?? null, recordedById: user.id },
    });
    if (v.boardedStudentIds.length) {
      await tx.facTripPassenger.createMany({ data: v.boardedStudentIds.map((studentId) => ({ schoolId: user.schoolId, tripId: trip.id, studentId, boardedAt: v.departedAt ?? new Date() })) });
    }
    if (v.odometerEnd !== undefined && v.odometerEnd > veh.odometerKm) await tx.facVehicle.update({ where: { id: veh.id }, data: { odometerKm: v.odometerEnd } });
    await audit(tx, user, 'FAC_TRIP_RECORD', 'FacTrip', trip.id, `Trip ${date}: ${veh.registration}${v.odometerStart !== undefined && v.odometerEnd !== undefined ? `, ${v.odometerEnd - v.odometerStart} km` : ''}, ${v.boardedStudentIds.length} on board`, undefined, { vehicleId, driverId, routeId: v.routeId ?? null, bookingId: v.bookingId ?? null, boarded: v.boardedStudentIds.length } as never);
    return { id: trip.id, boarded: v.boardedStudentIds.length };
  });
}

export const FuelSchema = z.object({
  vehicleId: idSchema, tripId: idSchema.optional(), date: isoDateSchema.optional(), litres: z.number().positive().max(2000), costCents: centsSchema, currency: currencySchema.default('USD'),
  receiptKey: optText(200), odometerKm: z.number().int().min(0).max(5_000_000).optional(),
});

/** Fuel bought for a vehicle: kept against the vehicle and recorded as an expense in Finance (never typed twice). */
export async function logFuel(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.trips');
  const v = FuelSchema.parse(raw);
  if (v.receiptKey && !proofKeyBelongsTo(v.receiptKey, user.schoolId)) throw new ServiceError('That receipt does not belong to this school', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const veh = await tx.facVehicle.findFirst({ where: { id: v.vehicleId, schoolId: user.schoolId } });
    if (!veh) throw new ServiceError('Vehicle not found', 404);
    if (v.tripId && !(await tx.facTrip.findFirst({ where: { id: v.tripId, schoolId: user.schoolId, vehicleId: v.vehicleId }, select: { id: true } }))) throw new ServiceError('Trip not found for that vehicle', 404);
    const date = v.date ?? todayInHarare();
    if (date > todayInHarare()) throw new ServiceError('The date cannot be in the future', 422);
    const exp = await recordFacilityExpense(tx, { schoolId: user.schoolId, actorId: user.id, category: 'Transport and fuel', description: `Fuel: ${veh.registration}, ${v.litres} litres`, currency: v.currency, amountCents: v.costCents, paidOn: toDay(date), receiptKey: v.receiptKey ?? null });
    const row = await tx.facFuelLog.create({ data: { schoolId: user.schoolId, vehicleId: v.vehicleId, tripId: v.tripId ?? null, date: toDay(date), litres: v.litres, costCents: v.costCents, currency: v.currency, receiptKey: v.receiptKey ?? null, odometerKm: v.odometerKm ?? null, expenseId: exp.expenseId, recordedById: user.id } });
    if (v.odometerKm !== undefined && v.odometerKm > veh.odometerKm) await tx.facVehicle.update({ where: { id: veh.id }, data: { odometerKm: v.odometerKm } });
    await audit(tx, user, 'FAC_FUEL_LOG', 'FacFuelLog', row.id, `Fuel for ${veh.registration}: ${v.litres} litres, ${formatMoney(v.costCents, v.currency)}`, undefined, { litres: v.litres, costCents: v.costCents, currency: v.currency, expense: exp.where, expenseId: exp.expenseId } as never);
    return { id: row.id, expense: exp.where };
  });
}

export async function recentTrips(user: Actor, days = 14) {
  need(user, ...VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const since = toDay(addDays(todayInHarare(), -days));
    const trips = await tx.facTrip.findMany({ where: { schoolId: user.schoolId, date: { gte: since } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
    const [vehicles, routes, pass] = await Promise.all([
      tx.facVehicle.findMany({ where: { id: { in: trips.map((t) => t.vehicleId) } }, select: { id: true, registration: true } }), tx.facRoute.findMany({ where: { id: { in: trips.map((t) => t.routeId ?? '') } }, select: { id: true, name: true } }),
      tx.facTripPassenger.groupBy({ by: ['tripId'], where: { tripId: { in: trips.map((t) => t.id) } }, _count: { _all: true } }),
    ]);
    return trips.map((t) => ({ id: t.id, date: isoOf(t.date), leg: t.leg, vehicle: vehicles.find((v) => v.id === t.vehicleId)?.registration ?? '', route: routes.find((r) => r.id === t.routeId)?.name ?? (t.bookingId ? 'School trip' : ''), km: t.odometerStart != null && t.odometerEnd != null ? t.odometerEnd - t.odometerStart : null, boarded: pass.find((p) => p.tripId === t.id)?._count._all ?? 0 }));
  });
}

// ─── Bookings (school trips) ─────────────────────────────────────────────────

export const BookingSchema = z.object({
  vehicleId: idSchema, driverId: idSchema.optional(), startAt: z.coerce.date(), endAt: z.coerce.date(), purpose: textSchema('the purpose', 3, 200), destination: optText(120),
  perLearnerCents: centsSchema.optional(), currency: currencySchema.optional(),
}).refine((v) => v.endAt > v.startAt, { message: 'The vehicle must be back after it leaves', path: ['endAt'] }).refine((v) => (v.perLearnerCents === undefined) === (v.currency === undefined), { message: 'A charge per learner needs its currency', path: ['currency'] });

export async function requestBooking(user: Actor, raw: unknown) {
  need(user, 'facilities.transport.manage', 'facilities.transport.trips');
  const v = BookingSchema.parse(raw);
  if (v.startAt.getTime() < Date.now() - DAY) throw new ServiceError('A booking cannot start in the past', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const veh = await tx.facVehicle.findFirst({ where: { id: v.vehicleId, schoolId: user.schoolId, active: true } });
    if (!veh) throw new ServiceError('Vehicle not found', 404);
    if (v.driverId && !(await tx.facDriver.findFirst({ where: { id: v.driverId, schoolId: user.schoolId, active: true }, select: { id: true } }))) throw new ServiceError('Driver not found', 404);
    const clash = await tx.facVehicleBooking.findFirst({
      where: { schoolId: user.schoolId, status: { in: ['PENDING', 'APPROVED'] }, cancelledAt: null, startAt: { lt: v.endAt }, endAt: { gt: v.startAt }, OR: [{ vehicleId: v.vehicleId }, ...(v.driverId ? [{ driverId: v.driverId }] : [])] }, select: { purpose: true, startAt: true },
    });
    if (clash) throw new ServiceError(`The vehicle or driver is already booked then (${clash.purpose})`, 409);
    const row = await tx.facVehicleBooking.create({ data: { schoolId: user.schoolId, vehicleId: v.vehicleId, driverId: v.driverId ?? null, startAt: v.startAt, endAt: v.endAt, purpose: v.purpose, destination: v.destination ?? null, perLearnerCents: v.perLearnerCents ?? null, currency: v.currency ?? null, requestedById: user.id } });
    await audit(tx, user, 'FAC_VEHICLE_BOOK', 'FacVehicleBooking', row.id, `Booking requested: ${veh.registration}, ${v.purpose}`, undefined, { startAt: v.startAt.toISOString(), endAt: v.endAt.toISOString() });
    await notifyUsers(tx, user.schoolId, await approverIds(tx, user.schoolId, 'facilities.transport.manage', user.id), { title: `Vehicle booking to approve: ${v.purpose}`, body: veh.registration, link: '/facilities/transport/bookings' });
    return { id: row.id };
  });
}

export async function decideBooking(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.transport.manage');
  const v = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'CANCEL']), reason: optText(200) }).parse(raw);
  if (v.decision !== 'APPROVE' && (v.reason ?? '').length < 3) throw new ServiceError('Say why', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const b = await tx.facVehicleBooking.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!b) throw new ServiceError('Booking not found', 404);
    if (v.decision === 'CANCEL') {
      if (b.status === 'REJECTED' || b.cancelledAt) throw new ServiceError('This booking is closed', 409);
      await tx.facVehicleBooking.update({ where: { id }, data: { cancelledAt: new Date(), status: 'REJECTED' } });
      await audit(tx, user, 'FAC_VEHICLE_BOOK', 'FacVehicleBooking', id, `Booking cancelled: ${v.reason}`, { status: b.status }, { status: 'REJECTED', reason: v.reason });
      return { status: 'CANCELLED' as const };
    }
    if (b.status !== 'PENDING') throw new ServiceError('This booking was already decided', 409);
    guards.cannotApproveOwn(user, b.requestedById, 'vehicle booking');
    if (v.decision === 'REJECT') {
      await tx.facVehicleBooking.update({ where: { id }, data: { status: 'REJECTED' } });
      await audit(tx, user, 'FAC_VEHICLE_BOOK', 'FacVehicleBooking', id, `Booking refused: ${v.reason}`, { status: 'PENDING' }, { status: 'REJECTED', reason: v.reason });
      await notifyUsers(tx, user.schoolId, [b.requestedById], { title: 'Vehicle booking refused', body: v.reason, link: '/facilities/transport/bookings' });
      return { status: 'REJECTED' as const };
    }
    const when = isoOf(b.startAt);
    const [vdocs, ddocs] = await Promise.all([tx.facVehicleDocument.findMany({ where: { vehicleId: b.vehicleId } }), b.driverId ? tx.facDriverDocument.findMany({ where: { driverId: b.driverId } }) : Promise.resolve([])]);
    const bad = [...paperStatus(vdocs, VEHICLE_DOCS, ['LICENCE', 'INSURANCE', 'FITNESS'], when), ...(b.driverId ? paperStatus(ddocs, DRIVER_DOCS, ['DRIVING_LICENCE'], when) : [])].filter((p) => p.state === 'EXPIRED' || p.state === 'MISSING');
    if (bad.length) throw new ServiceError(`Cannot approve: ${bad.map((p) => (p.state === 'MISSING' ? `no ${p.label.toLowerCase()}` : `${p.label.toLowerCase()} ran out ${p.expiry}`)).join('; ')}`, 409);
    await tx.facVehicleBooking.update({ where: { id }, data: { status: 'APPROVED', approvedById: user.id } });
    await audit(tx, user, 'FAC_VEHICLE_BOOK', 'FacVehicleBooking', id, 'Booking approved', { status: 'PENDING' }, { status: 'APPROVED', approvedById: user.id });
    await notifyUsers(tx, user.schoolId, [b.requestedById], { title: 'Vehicle booking approved', body: b.purpose, link: '/facilities/transport/bookings' });
    return { status: 'APPROVED' as const };
  });
}

/** Adds the learners going on a school trip and bills each the amount per learner (when the booking has one). */
export async function addBookingPassengers(user: Actor, id: string, raw: unknown) {
  need(user, 'facilities.transport.manage', 'facilities.transport.assign');
  const { studentIds } = z.object({ studentIds: z.array(idSchema).min(1).max(120) }).parse(raw);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const b = await tx.facVehicleBooking.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!b) throw new ServiceError('Booking not found', 404);
    if (b.status === 'REJECTED' || b.cancelledAt) throw new ServiceError('This booking is closed', 409);
    const veh = await tx.facVehicle.findUniqueOrThrow({ where: { id: b.vehicleId }, select: { seats: true, registration: true } });
    const have = new Set((await tx.facTripPassenger.findMany({ where: { bookingId: id, schoolId: user.schoolId }, select: { studentId: true } })).map((p) => p.studentId));
    const fresh = Array.from(new Set(studentIds)).filter((s) => !have.has(s));
    if (have.size + fresh.length > veh.seats) throw new ServiceError(`${veh.registration} has ${veh.seats} seats`, 409);
    const students = await tx.student.findMany({ where: { id: { in: fresh }, schoolId: user.schoolId, status: 'ACTIVE' }, select: { id: true, fullName: true } });
    if (students.length !== fresh.length) throw new ServiceError('A learner was not found', 404);
    let billed = 0;
    for (const s of students) {
      const p = await tx.facTripPassenger.create({ data: { schoolId: user.schoolId, bookingId: id, studentId: s.id } });
      if (b.perLearnerCents && b.perLearnerCents > 0 && b.currency) {
        const c = await chargeLearner(tx, { schoolId: user.schoolId, actorId: user.id, studentId: s.id, part: 'TRANSPORT', kind: 'TRIP', description: `School trip: ${b.purpose}`.slice(0, 200), currency: b.currency as Cur, amountCents: b.perLearnerCents, sourceType: 'FacTripPassenger', sourceId: p.id });
        await tx.facTripPassenger.update({ where: { id: p.id }, data: { chargeId: c.chargeId, ledgerEntryId: c.ledgerEntryId } });
        billed++;
      }
    }
    await audit(tx, user, 'FAC_VEHICLE_BOOK', 'FacVehicleBooking', id, `${students.length} learners added to ${b.purpose}${billed ? `, ${billed} charged` : ''}`, undefined, { added: students.length, billed } as never);
    return { added: students.length, billed };
  });
}

export async function listBookings(user: Actor) {
  need(user, ...VIEW);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const rows = await tx.facVehicleBooking.findMany({ where: { schoolId: user.schoolId, endAt: { gte: new Date(Date.now() - 7 * DAY) } }, orderBy: { startAt: 'asc' }, take: 200 });
    const [vehicles, people, pass] = await Promise.all([
      tx.facVehicle.findMany({ where: { id: { in: rows.map((r) => r.vehicleId) } }, select: { id: true, registration: true } }), tx.user.findMany({ where: { id: { in: rows.map((r) => r.requestedById) } }, select: { id: true, fullName: true } }),
      tx.facTripPassenger.groupBy({ by: ['bookingId'], where: { bookingId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
    ]);
    return rows.map((r) => ({ id: r.id, vehicle: vehicles.find((v) => v.id === r.vehicleId)?.registration ?? '', startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), purpose: r.purpose, destination: r.destination, status: r.cancelledAt ? 'CANCELLED' : r.status, requestedBy: people.find((p) => p.id === r.requestedById)?.fullName ?? '', requestedById: r.requestedById, perLearnerCents: r.perLearnerCents, currency: r.currency as Cur | null, learners: pass.find((p) => p.bookingId === r.id)?._count._all ?? 0 }));
  });
}

// ─── Alerts and reports ──────────────────────────────────────────────────────

/** Papers that run out within 30 days (or already have): the transport manager is told once per paper and window. Run by the nightly job. */
export async function documentAlerts(tx: Db, schoolId: string): Promise<number> {
  const today = todayInHarare();
  const horizon = toDay(addDays(today, 30));
  const [vdocs, ddocs] = await Promise.all([tx.facVehicleDocument.findMany({ where: { schoolId, expiry: { lte: horizon } } }), tx.facDriverDocument.findMany({ where: { schoolId, expiry: { lte: horizon } } })]);
  if (vdocs.length + ddocs.length === 0) return 0;
  const [allV, allD] = await Promise.all([tx.facVehicleDocument.findMany({ where: { schoolId } }), tx.facDriverDocument.findMany({ where: { schoolId } })]);
  const vehicles = await tx.facVehicle.findMany({ where: { schoolId, active: true }, select: { id: true, registration: true } });
  const drivers = await tx.facDriver.findMany({ where: { schoolId, active: true } });
  const emps = await tx.employee.findMany({ where: { id: { in: drivers.map((d) => d.employeeId) } }, select: { id: true, firstName: true, surname: true } });
  const to = await approverIds(tx, schoolId, 'facilities.transport.manage');
  let sent = 0;
  const newest = <T extends { type: string; expiry: Date }>(list: T[], type: string) => list.filter((d) => d.type === type).sort((a, b) => b.expiry.getTime() - a.expiry.getTime())[0];
  for (const v of vehicles) for (const type of VEHICLE_DOCS) {
    const d = newest(allV.filter((x) => x.vehicleId === v.id), type);
    if (d && d.expiry <= horizon) sent += await notifyUsers(tx, schoolId, to, { title: `${v.registration}: ${DOC_LABEL[type]} ${d.expiry < toDay(today) ? 'has run out' : 'runs out soon'}`, body: `Valid to ${isoOf(d.expiry)}. The vehicle cannot make trips once it has run out.`, link: '/facilities/transport/fleet', dedupeKey: `transport-doc:${d.id}:${d.expiry < toDay(today) ? 'out' : 'soon'}` });
  }
  for (const dr of drivers) for (const type of DRIVER_DOCS) {
    const d = newest(allD.filter((x) => x.driverId === dr.id), type);
    const e = emps.find((x) => x.id === dr.employeeId);
    if (d && d.expiry <= horizon) sent += await notifyUsers(tx, schoolId, to, { title: `${e ? `${e.firstName} ${e.surname}` : 'A driver'}: ${DOC_LABEL[type]} ${d.expiry < toDay(today) ? 'has run out' : 'runs out soon'}`, body: `Valid to ${isoOf(d.expiry)}.`, link: '/facilities/transport/fleet', dedupeKey: `transport-doc:${d.id}:${d.expiry < toDay(today) ? 'out' : 'soon'}` });
  }
  return sent;
}

export async function transportReport(user: Actor, f: { from?: string; to?: string } = {}) {
  need(user, ...VIEW);
  const to = f.to ?? todayInHarare(); const from = f.from ?? addDays(to, -30);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const [vehicles, trips, fuel] = await Promise.all([
      tx.facVehicle.findMany({ where: { schoolId: user.schoolId }, orderBy: { registration: 'asc' } }),
      tx.facTrip.findMany({ where: { schoolId: user.schoolId, date: { gte: toDay(from), lte: toDay(to) } } }),
      tx.facFuelLog.findMany({ where: { schoolId: user.schoolId, date: { gte: toDay(from), lte: toDay(to) } } }),
    ]);
    const perVehicle = vehicles.map((v) => {
      const t = trips.filter((x) => x.vehicleId === v.id);
      const km = t.reduce((s, x) => s + (x.odometerStart != null && x.odometerEnd != null ? x.odometerEnd - x.odometerStart : 0), 0);
      const fl = fuel.filter((x) => x.vehicleId === v.id);
      const litres = Math.round(fl.reduce((s, x) => s + x.litres, 0) * 100) / 100;
      const cost = (['USD', 'ZIG'] as const).map((currency) => ({ currency, cents: fl.filter((x) => x.currency === currency).reduce((s, x) => s + x.costCents, 0) })).filter((c) => c.cents > 0);
      return { vehicleId: v.id, registration: v.registration, trips: t.length, km, litres, kmPerLitre: litres > 0 && km > 0 ? Math.round((km / litres) * 10) / 10 : null, fuelCost: cost, costPerKm: cost.map((c) => ({ currency: c.currency, cents: km > 0 ? Math.round(c.cents / km) : null })) };
    });
    return { from, to, perVehicle };
  });
}
