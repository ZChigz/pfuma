// The Facilities & Operations overview: one card per part the person may see and the school has switched on, each with the few figures that
// need attention today, and the reports that read across the parts. A part the person has no permission for, or the school has switched
// off, is not in the answer at all. Money is never added across currencies.
import type { Prisma } from '@prisma/client';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { can, type FacilityPart, type PermissionKey } from '@/lib/access-core';
import { scopeWhere } from '@/lib/access/where';
import { addDays, need, partOn, todayInHarare, toDay, type Actor } from '@/lib/facilities/common';
import { ANY_FACILITIES } from '@/lib/facilities/people';
import { weekStart } from '@/lib/facilities/tuckshop';

export interface Card { part: FacilityPart; title: string; href: string; figures: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }[] }

const money = (c: number, cur: string) => `${cur === 'ZIG' ? 'ZiG ' : '$'}${(c / 100).toFixed(2)}`;
const anyOf = (u: Actor, keys: PermissionKey[]) => keys.find((k) => can(u, k));

type Maker = (tx: Db, user: Actor, key: PermissionKey) => Promise<Card['figures']>;

const MAKERS: { part: FacilityPart; title: string; href: string; keys: PermissionKey[]; make: Maker }[] = [
  {
    part: 'hostel', title: 'Hostel', href: '/facilities/hostel', keys: ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'],
    make: async (tx, u) => {
      const [beds, filled] = await Promise.all([tx.facBed.count({ where: { schoolId: u.schoolId } }), tx.facBedAllocation.count({ where: { schoolId: u.schoolId, toDate: null } })]);
      const today = toDay(todayInHarare());
      const taken = await tx.facRollCall.count({ where: { schoolId: u.schoolId, date: today } });
      const unhoused = await tx.student.count({ where: { schoolId: u.schoolId, status: 'ACTIVE', boarding: 'BOARDER', NOT: { id: { in: (await tx.facBedAllocation.findMany({ where: { schoolId: u.schoolId, toDate: null }, select: { studentId: true } })).map((a) => a.studentId) } } } });
      return [
        { label: 'Beds filled', value: `${filled} of ${beds}`, tone: beds > 0 && filled > beds ? 'bad' : 'ok' }, { label: 'Roll calls today', value: String(taken) },
        { label: 'Boarders with no bed', value: String(unhoused), tone: unhoused ? 'warn' : 'ok' },
      ];
    },
  },
  {
    part: 'exeats', title: 'Exeats', href: '/facilities/exeats', keys: ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout', 'facilities.visitors.log'],
    make: async (tx, u, key) => {
      const reach = (await scopeWhere(u, key, 'FacExeat', tx)) as Prisma.FacExeatWhereInput;
      const base = { AND: [reach, { schoolId: u.schoolId }] };
      const now = new Date();
      const [waiting, out, late] = await Promise.all([
        tx.facExeat.count({ where: { ...base, status: 'REQUESTED' } }), tx.facExeat.count({ where: { ...base, status: 'SIGNED_OUT' } }), tx.facExeat.count({ where: { ...base, status: 'SIGNED_OUT', dueBackAt: { lt: now } } }),
      ]);
      return [{ label: 'Waiting for approval', value: String(waiting), tone: waiting ? 'warn' : 'ok' }, { label: 'Out now', value: String(out) }, { label: 'Not back', value: String(late), tone: late ? 'bad' : 'ok' }];
    },
  },
  {
    part: 'sickbay', title: 'Sick bay', href: '/facilities/sickbay', keys: ['facilities.sickbay.record', 'facilities.sickbay.view'],
    make: async (tx, u) => {
      const today = toDay(todayInHarare());
      const [resting, visits, missed] = await Promise.all([
        tx.facSickBayVisit.count({ where: { schoolId: u.schoolId, admittedAt: { not: null }, dischargedAt: null } }), tx.facSickBayVisit.count({ where: { schoolId: u.schoolId, visitedAt: { gte: today } } }),
        tx.facMedicationDose.count({ where: { schoolId: u.schoolId, missed: true, createdAt: { gte: today } } }),
      ]);
      return [{ label: 'Resting now', value: String(resting) }, { label: 'Visits today', value: String(visits) }, { label: 'Missed doses today', value: String(missed), tone: missed ? 'bad' : 'ok' }];
    },
  },
  {
    part: 'tuckshop', title: 'Tuck shop and pocket money', href: '/facilities/tuckshop', keys: ['facilities.tuckshop.sell', 'facilities.tuckshop.cashup', 'facilities.wallets.manage', 'facilities.wallets.view'],
    make: async (tx, u) => {
      const from = new Date(`${todayInHarare()}T00:00:00+02:00`);
      const sales = await tx.facTuckShopSale.groupBy({ by: ['currency'], where: { schoolId: u.schoolId, soldAt: { gte: from } }, _sum: { totalCents: true } });
      const open = await tx.facTuckShopSale.count({ where: { schoolId: u.schoolId, payment: 'CASH', cashUpId: null, soldAt: { lt: from } } });
      const wallets = await tx.facWallet.count({ where: { schoolId: u.schoolId, closedAt: null } });
      return [
        { label: 'Sold today', value: sales.length ? sales.map((s) => money(s._sum.totalCents ?? 0, s.currency)).join(' · ') : 'Nothing yet' },
        { label: 'Days of cash not cashed up', value: String(open), tone: open ? 'warn' : 'ok' }, { label: 'Open wallets', value: String(wallets) },
      ];
    },
  },
  {
    part: 'library', title: 'Library', href: '/facilities/library', keys: ['facilities.library.view', 'facilities.library.desk', 'facilities.library.manage', 'facilities.textbooks.issue'],
    make: async (tx, u) => {
      const now = new Date();
      const [out, overdue, copies] = await Promise.all([
        tx.facLoan.count({ where: { schoolId: u.schoolId, returnedAt: null } }), tx.facLoan.count({ where: { schoolId: u.schoolId, returnedAt: null, dueAt: { lt: now } } }), tx.facBookCopy.count({ where: { schoolId: u.schoolId } }),
      ]);
      return [{ label: 'Books out', value: String(out) }, { label: 'Overdue', value: String(overdue), tone: overdue ? 'warn' : 'ok' }, { label: 'Copies in the library', value: String(copies) }];
    },
  },
  {
    part: 'inventory', title: 'Inventory', href: '/facilities/inventory', keys: ['facilities.inventory.view', 'facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff'],
    make: async (tx, u) => {
      const [items, writeoffs, counts] = await Promise.all([
        tx.facStockItem.count({ where: { schoolId: u.schoolId, active: true } }), tx.facWriteoffRequest.count({ where: { schoolId: u.schoolId, status: 'PENDING' } }), tx.facStockCount.count({ where: { schoolId: u.schoolId, approvedById: null } }),
      ]);
      return [{ label: 'Items', value: String(items) }, { label: 'Write-offs to approve', value: String(writeoffs), tone: writeoffs ? 'warn' : 'ok' }, { label: 'Counts not approved', value: String(counts), tone: counts ? 'warn' : 'ok' }];
    },
  },
  {
    part: 'assets', title: 'Assets', href: '/facilities/assets', keys: ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'],
    make: async (tx, u) => {
      const soon = toDay(addDays(todayInHarare(), 14));
      const [assets, due, faults, disposals] = await Promise.all([
        tx.facAsset.count({ where: { schoolId: u.schoolId, status: { not: 'DISPOSED' } } }), tx.facMaintenanceSchedule.count({ where: { schoolId: u.schoolId, active: true, nextDueAt: { lte: soon } } }),
        tx.facMaintenanceJob.count({ where: { schoolId: u.schoolId, status: { in: ['REPORTED', 'ASSIGNED'] } } }), tx.facDisposalRequest.count({ where: { schoolId: u.schoolId, status: 'PENDING' } }),
      ]);
      return [{ label: 'Assets', value: String(assets) }, { label: 'Services due within 14 days', value: String(due), tone: due ? 'warn' : 'ok' }, { label: 'Open faults', value: String(faults), tone: faults ? 'warn' : 'ok' }, { label: 'Disposals to approve', value: String(disposals), tone: disposals ? 'warn' : 'ok' }];
    },
  },
  {
    part: 'transport', title: 'Transport', href: '/facilities/transport', keys: ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'],
    make: async (tx, u) => {
      const horizon = toDay(addDays(todayInHarare(), 30));
      const [riders, expiring, driverExpiring, pending] = await Promise.all([
        tx.facStudentRoute.count({ where: { schoolId: u.schoolId, removedAt: null } }), tx.facVehicleDocument.count({ where: { schoolId: u.schoolId, expiry: { lte: horizon } } }),
        tx.facDriverDocument.count({ where: { schoolId: u.schoolId, expiry: { lte: horizon } } }), tx.facVehicleBooking.count({ where: { schoolId: u.schoolId, status: 'PENDING', cancelledAt: null } }),
      ]);
      const papers = expiring + driverExpiring;
      return [{ label: 'Learners on routes', value: String(riders) }, { label: 'Papers out or running out in 30 days', value: String(papers), tone: papers ? 'warn' : 'ok' }, { label: 'Bookings to approve', value: String(pending), tone: pending ? 'warn' : 'ok' }];
    },
  },
];

/** The cards this person may see. Each part has its own check and its own switch; one failing never hides the others. */
export async function facilitiesOverview(user: Actor): Promise<{ cards: Card[]; hidden: number }> {
  need(user, ...ANY_FACILITIES);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const cards: Card[] = [];
    let hidden = 0;
    for (const m of MAKERS) {
      const key = anyOf(user, m.keys);
      if (!key) continue;
      if (!(await partOn(tx, user.schoolId, m.part))) { hidden++; continue; }
      try { cards.push({ part: m.part, title: m.title, href: m.href, figures: await m.make(tx, user, key) }); } catch { /* a part that cannot be read shows no card */ }
    }
    return { cards, hidden };
  });
}

// ─── Reports across the parts ────────────────────────────────────────────────

export interface ReportSection { part: FacilityPart; title: string; rows: { label: string; value: string }[]; link: string }

/** Figures for a period, one section per part the person may see. Counts only for the sick bay: never names or complaints of a learner. */
export async function facilitiesReport(user: Actor, f: { from?: string; to?: string } = {}): Promise<{ from: string; to: string; sections: ReportSection[] }> {
  need(user, ...ANY_FACILITIES);
  const to = f.to ?? todayInHarare();
  const from = f.from ?? addDays(to, -30);
  const a = new Date(`${from}T00:00:00+02:00`); const b = new Date(new Date(`${to}T00:00:00+02:00`).getTime() + 86_400_000);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const sections: ReportSection[] = [];
    const on = async (part: FacilityPart, keys: PermissionKey[]) => !!anyOf(user, keys) && (await partOn(tx, user.schoolId, part));
    const per = (rows: { label: string; value: string }[], part: FacilityPart, title: string, link: string) => sections.push({ part, title, rows, link });

    if (await on('exeats', ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout'])) {
      const g = await tx.facExeat.groupBy({ by: ['type'], where: { schoolId: user.schoolId, outAt: { gte: a, lt: b } }, _count: { _all: true } });
      const late = await tx.facExeat.count({ where: { schoolId: user.schoolId, outAt: { gte: a, lt: b }, overdueAlertedAt: { not: null } } });
      const visits = await tx.facVisitorLog.count({ where: { schoolId: user.schoolId, timeIn: { gte: a, lt: b } } });
      per([...g.map((x) => ({ label: `${x.type.charAt(0)}${x.type.slice(1).toLowerCase().replace('_', ' ')} exeats`, value: String(x._count._all) })), { label: 'Returned late', value: String(late) }, { label: 'Visitors logged', value: String(visits) }], 'exeats', 'Exeats and visitors', '/facilities/exeats');
    }
    if (await on('sickbay', ['facilities.sickbay.record', 'facilities.sickbay.view'])) {
      const g = await tx.facSickBayVisit.groupBy({ by: ['outcome'], where: { schoolId: user.schoolId, visitedAt: { gte: a, lt: b } }, _count: { _all: true } });
      const c = await tx.facSickBayVisit.groupBy({ by: ['complaint'], where: { schoolId: user.schoolId, visitedAt: { gte: a, lt: b } }, _count: { _all: true } });
      per([...g.map((x) => ({ label: x.outcome.toLowerCase().replace(/_/g, ' '), value: String(x._count._all) })), ...c.map((x) => ({ label: `complaint: ${x.complaint.toLowerCase().replace('_', ' ')}`, value: String(x._count._all) }))], 'sickbay', 'Sick bay (counts only)', '/facilities/sickbay');
    }
    if (await on('tuckshop', ['facilities.tuckshop.cashup', 'facilities.wallets.manage', 'facilities.wallets.view'])) {
      const sales = await tx.facTuckShopSale.groupBy({ by: ['currency', 'payment'], where: { schoolId: user.schoolId, soldAt: { gte: a, lt: b } }, _sum: { totalCents: true, costCents: true } });
      const rows: { label: string; value: string }[] = [];
      for (const cur of ['USD', 'ZIG'] as const) {
        const mine = sales.filter((s) => s.currency === cur);
        if (!mine.length) continue;
        const total = mine.reduce((s, x) => s + (x._sum.totalCents ?? 0), 0); const cost = mine.reduce((s, x) => s + (x._sum.costCents ?? 0), 0);
        rows.push({ label: `${cur} sales`, value: money(total, cur) }, { label: `${cur} cost of goods`, value: money(cost, cur) }, { label: `${cur} gross profit`, value: money(total - cost, cur) });
      }
      const diff = await tx.facTuckShopCashUp.findMany({ where: { schoolId: user.schoolId, date: { gte: toDay(from), lte: toDay(to) } }, select: { currency: true, expectedCashCents: true, countedCashCents: true } });
      for (const cur of ['USD', 'ZIG'] as const) { const d = diff.filter((x) => x.currency === cur).reduce((s, x) => s + (x.countedCashCents - x.expectedCashCents), 0); if (diff.some((x) => x.currency === cur)) rows.push({ label: `${cur} cash-up difference`, value: money(d, cur) }); }
      const bal = await tx.facWalletEntry.groupBy({ by: ['currency'], where: { schoolId: user.schoolId }, _sum: { amountCents: true } });
      for (const x of bal) rows.push({ label: `${x.currency} held in wallets`, value: money(x._sum.amountCents ?? 0, x.currency) });
      rows.push({ label: 'Since Monday spent from wallets', value: String((await tx.facWalletEntry.count({ where: { schoolId: user.schoolId, type: 'PURCHASE', createdAt: { gte: weekStart(new Date()) } } }))) + ' purchases' });
      per(rows, 'tuckshop', 'Tuck shop and pocket money', '/facilities/tuckshop');
    }
    if (await on('hostel', ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.inspect'])) {
      const [beds, filled, insp, damage] = await Promise.all([
        tx.facBed.count({ where: { schoolId: user.schoolId } }), tx.facBedAllocation.count({ where: { schoolId: user.schoolId, toDate: null } }),
        tx.facInspection.aggregate({ where: { schoolId: user.schoolId, createdAt: { gte: a, lt: b } }, _avg: { score: true }, _count: { _all: true } }),
        tx.facInspectionItem.count({ where: { schoolId: user.schoolId, damageApprovedById: { not: null }, createdAt: { gte: a, lt: b } } }),
      ]);
      per([{ label: 'Occupancy', value: beds ? `${filled} of ${beds} beds (${Math.round((filled / beds) * 100)}%)` : 'No beds' }, { label: 'Inspections', value: String(insp._count._all) }, { label: 'Average inspection score', value: insp._avg.score != null ? `${Math.round(insp._avg.score)} out of 100` : 'None' }, { label: 'Damage charges approved', value: String(damage) }], 'hostel', 'Hostel', '/facilities/hostel');
    }
    if (await on('transport', ['facilities.transport.view', 'facilities.transport.manage', 'facilities.transport.trips'])) {
      const [trips, fuel] = await Promise.all([
        tx.facTrip.findMany({ where: { schoolId: user.schoolId, date: { gte: toDay(from), lte: toDay(to) } }, select: { odometerStart: true, odometerEnd: true } }),
        tx.facFuelLog.groupBy({ by: ['currency'], where: { schoolId: user.schoolId, date: { gte: toDay(from), lte: toDay(to) } }, _sum: { costCents: true, litres: true } }),
      ]);
      const km = trips.reduce((s, t) => s + (t.odometerStart != null && t.odometerEnd != null ? t.odometerEnd - t.odometerStart : 0), 0);
      per([{ label: 'Trips', value: String(trips.length) }, { label: 'Kilometres', value: String(km) }, ...fuel.map((x) => ({ label: `${x.currency} fuel`, value: `${money(x._sum.costCents ?? 0, x.currency)} for ${Math.round((x._sum.litres ?? 0) * 10) / 10} litres` }))], 'transport', 'Transport', '/facilities/transport/report');
    }
    if (await on('library', ['facilities.library.view', 'facilities.library.manage'])) {
      const [out, back, overdue] = await Promise.all([tx.facLoan.count({ where: { schoolId: user.schoolId, outAt: { gte: a, lt: b } } }), tx.facLoan.count({ where: { schoolId: user.schoolId, returnedAt: { gte: a, lt: b } } }), tx.facLoan.count({ where: { schoolId: user.schoolId, returnedAt: null, dueAt: { lt: new Date() } } })]);
      per([{ label: 'Books lent', value: String(out) }, { label: 'Books returned', value: String(back) }, { label: 'Overdue now', value: String(overdue) }], 'library', 'Library', '/facilities/library/reports');
    }
    if (await on('inventory', ['facilities.inventory.view', 'facilities.inventory.manage'])) {
      const g = await tx.facStockMovement.groupBy({ by: ['type'], where: { schoolId: user.schoolId, createdAt: { gte: a, lt: b } }, _count: { _all: true } });
      per(g.map((x) => ({ label: `${x.type.toLowerCase()} movements`, value: String(x._count._all) })), 'inventory', 'Inventory', '/facilities/inventory/reports');
    }
    if (await on('assets', ['facilities.assets.view', 'facilities.assets.manage'])) {
      const [reg, jobs, done] = await Promise.all([tx.facAsset.count({ where: { schoolId: user.schoolId, status: { not: 'DISPOSED' } } }), tx.facMaintenanceJob.count({ where: { schoolId: user.schoolId, createdAt: { gte: a, lt: b } } }), tx.facMaintenanceJob.count({ where: { schoolId: user.schoolId, status: 'DONE', doneAt: { gte: a, lt: b } } })]);
      per([{ label: 'Assets on the register', value: String(reg) }, { label: 'Jobs opened', value: String(jobs) }, { label: 'Jobs finished', value: String(done) }], 'assets', 'Assets', '/facilities/assets/reports');
    }
    return { from, to, sections };
  });
}

