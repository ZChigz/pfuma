// What the Pfuma console does to a school. Everything here is about the school's account with Pfuma
// (status, plan, student limit, modules, invoices, the first two invites). It never edits the school's
// own records (students, marks, payments ...), and every action writes a PlatformAuditLog row in the
// same transaction. Uses the raw client on purpose: a console admin belongs to no school.
import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { ALWAYS_ON_MODULES, MODULE_KEYS } from '@/lib/access-core';
import { logPlatform } from '@/lib/platform/audit';
import { presetModules, PRESETS, type PresetKey } from '@/lib/platform/presets';
import type { PlatformAdminContext } from '@/lib/platform/session';
import { hashResetToken, INVITE_TTL_MS, resetUrl } from '@/lib/password-reset';
import { prisma } from '@/lib/prisma';
import { accessFor } from '@/lib/staff-roles';
import { getModuleStates } from '@/lib/platform/modules';
import type { BillingPatchSchema, CreateSchoolSchema } from '@/lib/validations/platform';

type Admin = PlatformAdminContext;

const date = (v: string) => new Date(`${v}T00:00:00.000Z`);
const unusablePassword = () => `!invited!${randomBytes(24).toString('hex')}`;

// ─── Reading ─────────────────────────────────────────────────────────────────

export const SCHOOL_SORT = ['name', 'createdAt'] as const;
export interface SchoolListQuery { q?: string; status?: string; page: number; pageSize: number }
const STATUSES = ['TRIAL', 'ACTIVE', 'OVERDUE', 'SUSPENDED'] as const;
export const isStatus = (v: unknown): v is (typeof STATUSES)[number] => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

export async function listSchools(q: SchoolListQuery) {
  const where: Prisma.SchoolWhereInput = {
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { province: { contains: q.q, mode: 'insensitive' } }, { id: q.q }] } : {}),
    ...(isStatus(q.status) ? { status: q.status } : {}),
  };
  const [total, rows, counts] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({
      where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      select: {
        id: true, name: true, schoolType: true, province: true, status: true, renewalDate: true, studentLimit: true, createdAt: true,
        plan: { select: { name: true } }, _count: { select: { users: { where: { isSupport: false, active: true } }, students: { where: { status: 'ACTIVE' } } } },
      },
    }),
    prisma.school.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  return { total, rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

export const listPlans = () => prisma.plan.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, key: true } });

export async function getSchoolDetail(id: string) {
  const school = await prisma.school.findUnique({
    where: { id },
    select: {
      id: true, name: true, schoolType: true, province: true, boarding: true, status: true, suspendedReason: true, renewalDate: true, studentLimit: true,
      planId: true, createdAt: true, plan: { select: { id: true, name: true } },
      _count: { select: { students: { where: { status: 'ACTIVE' } }, users: { where: { isSupport: false, active: true } } } },
    },
  });
  if (!school) throw new ServiceError('School not found', 404);
  const [modules, invoices, plans, people, audit] = await Promise.all([
    getModuleStates(id),
    prisma.subscriptionInvoice.findMany({ where: { schoolId: id }, orderBy: [{ issuedOn: 'desc' }, { number: 'desc' }] }),
    prisma.plan.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, modules: true } }),
    prisma.user.findMany({
      where: { schoolId: id, isSupport: false, userRoles: { some: { role: { key: { in: ['OWNER', 'ADMINISTRATOR'] } } } } },
      select: { id: true, fullName: true, email: true, active: true, invitePending: true, userRoles: { select: { role: { select: { key: true } } } } },
      orderBy: { fullName: 'asc' },
    }),
    prisma.platformAuditLog.findMany({ where: { schoolId: id }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, action: true, detail: true, createdAt: true, admin: { select: { fullName: true } } } }),
  ]);
  return { school, modules, invoices, plans, people, audit };
}

// ─── Creating a school ───────────────────────────────────────────────────────

export interface CreatedInvite { role: 'OWNER' | 'ADMINISTRATOR'; fullName: string; email: string; phone: string; url: string }

type CreateInput = z.output<typeof CreateSchoolSchema>;

/**
 * A school with its first Owner and Administrator. Each gets an invite link (72 hours, one use) that is
 * returned once and never stored in readable form. The 13 roles and their grants are created for the
 * school by the database.
 */
export async function createSchool(admin: Admin, input: CreateInput) {
  const preset = PRESETS[input.preset];
  const plan = input.planId
    ? await prisma.plan.findUnique({ where: { id: input.planId } })
    : await prisma.plan.findUnique({ where: { key: 'STANDARD' } });
  if (input.planId && !plan) throw new ServiceError('That plan does not exist', 422);

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const school = await tx.school.create({
      data: {
        name: input.name, schoolType: input.schoolType, province: input.province, boarding: preset.boarding,
        status: input.status, planId: plan?.id ?? null, studentLimit: input.studentLimit ?? plan?.defaultStudentLimit ?? null,
        renewalDate: input.renewalDate ? date(input.renewalDate) : null,
        currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: 'USD',
      },
    });

    // A school created now keeps its money in the Finance module from the start; the older accounting screens stay read-only.
    await tx.finSettings.create({ data: { schoolId: school.id, legacyRetired: true } });

    const modules = presetModules(input.preset);
    await tx.schoolModule.createMany({
      data: MODULE_KEYS.filter((k) => !ALWAYS_ON_MODULES.includes(k) || modules[k]).map((module) => ({
        schoolId: school.id, module, enabled: modules[module], enabledAt: now, enabledByPlatformAdminId: admin.id,
      })),
    });

    const invites: CreatedInvite[] = [];
    for (const [role, person] of [['OWNER', input.owner], ['ADMINISTRATOR', input.administrator]] as const) {
      const user = await tx.user.create({
        data: {
          schoolId: school.id, fullName: person.fullName, email: person.email, phone: person.phone,
          role: accessFor([role]), passwordHash: unusablePassword(), invitePending: true, invitedAt: now,
        },
        select: { id: true },
      });
      const token = randomBytes(32).toString('base64url');
      await tx.passwordResetToken.create({
        data: { schoolId: school.id, userId: user.id, tokenHash: hashResetToken(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS), createdById: user.id, kind: 'INVITE' },
      });
      invites.push({ role, fullName: person.fullName, email: person.email, phone: person.phone, url: resetUrl(token, true) });
    }

    await logPlatform(admin, {
      action: 'SCHOOL_CREATED', schoolId: school.id, entityType: 'School', entityId: school.id,
      detail: `${school.name} (${preset.label}); invited ${input.owner.email} as Owner and ${input.administrator.email} as Administrator`,
      after: { name: school.name, schoolType: school.schoolType, province: school.province, preset: input.preset, status: school.status, planId: school.planId, studentLimit: school.studentLimit },
    }, tx);
    return { school: { id: school.id, name: school.name }, invites };
  });
}

// ─── Modules, billing, status ────────────────────────────────────────────────

async function mustExist(id: string) {
  const s = await prisma.school.findUnique({ where: { id }, select: { id: true, name: true, status: true, planId: true, studentLimit: true, renewalDate: true, suspendedReason: true } });
  if (!s) throw new ServiceError('School not found', 404);
  return s;
}

export async function setSchoolModules(admin: Admin, schoolId: string, input: { modules?: Record<string, boolean>; preset?: PresetKey }) {
  const school = await mustExist(schoolId);
  const wanted: Record<string, boolean> = { ...(input.preset ? presetModules(input.preset) : {}), ...(input.modules ?? {}) };
  for (const [k, on] of Object.entries(wanted)) {
    if (!MODULE_KEYS.includes(k)) throw new ServiceError(`Unknown module "${k}"`, 422);
    if (ALWAYS_ON_MODULES.includes(k) && !on) throw new ServiceError('Dashboard & System cannot be switched off', 422);
  }
  const before = await getModuleStates(schoolId);
  const changes = Object.entries(wanted).filter(([k, on]) => before[k] !== on);
  if (changes.length === 0) return before;

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const [module, enabled] of changes) {
      await tx.schoolModule.upsert({
        where: { schoolId_module: { schoolId, module } },
        update: { enabled, enabledAt: now, enabledByPlatformAdminId: admin.id },
        create: { schoolId, module, enabled, enabledAt: now, enabledByPlatformAdminId: admin.id },
      });
    }
    const after = { ...before, ...Object.fromEntries(changes) };
    await logPlatform(admin, {
      action: 'MODULES_CHANGED', schoolId, entityType: 'SchoolModule', entityId: schoolId,
      detail: `${school.name}: ${input.preset ? `${PRESETS[input.preset].label} preset; ` : ''}${changes.map(([k, on]) => `${k} ${on ? 'on' : 'off'}`).join(', ')}`,
      before, after,
    }, tx);
    return after;
  });
}

export async function updateBilling(admin: Admin, schoolId: string, input: z.output<typeof BillingPatchSchema>) {
  const school = await mustExist(schoolId);
  if (school.status === 'SUSPENDED' && input.status) throw new ServiceError('Reactivate the school first', 409);
  if (input.planId) {
    if (!(await prisma.plan.findUnique({ where: { id: input.planId }, select: { id: true } }))) throw new ServiceError('That plan does not exist', 422);
  }
  const data: Prisma.SchoolUncheckedUpdateInput = {
    ...(input.planId !== undefined ? { planId: input.planId } : {}),
    ...(input.studentLimit !== undefined ? { studentLimit: input.studentLimit } : {}),
    ...(input.renewalDate !== undefined ? { renewalDate: input.renewalDate ? date(input.renewalDate) : null } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  return prisma.$transaction(async (tx) => {
    const updated = await tx.school.update({ where: { id: schoolId }, data, select: { planId: true, studentLimit: true, renewalDate: true, status: true } });
    await logPlatform(admin, {
      action: 'BILLING_CHANGED', schoolId, entityType: 'School', entityId: schoolId, detail: school.name,
      before: { planId: school.planId, studentLimit: school.studentLimit, renewalDate: school.renewalDate?.toISOString().slice(0, 10) ?? null, status: school.status },
      after: { planId: updated.planId, studentLimit: updated.studentLimit, renewalDate: updated.renewalDate?.toISOString().slice(0, 10) ?? null, status: updated.status },
    }, tx);
    return updated;
  });
}

/** The people at the school who should hear about a change to the account. */
async function accountContacts(tx: Prisma.TransactionClient, schoolId: string) {
  const rows = await tx.user.findMany({
    where: { schoolId, active: true, isSupport: false, userRoles: { some: { role: { key: { in: ['OWNER', 'ADMINISTRATOR'] } } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function suspendSchool(admin: Admin, schoolId: string, reason: string) {
  const school = await mustExist(schoolId);
  if (school.status === 'SUSPENDED') throw new ServiceError('This school is already suspended', 409);
  return prisma.$transaction(async (tx) => {
    await tx.school.update({ where: { id: schoolId }, data: { status: 'SUSPENDED', suspendedReason: reason } });
    // Everyone's open session carries on in read-only mode; nobody is signed out.
    const ids = await accountContacts(tx, schoolId);
    await tx.notification.createMany({
      data: ids.map((userId) => ({ schoolId, userId, type: 'SUBSCRIPTION', title: 'Your subscription is suspended', body: 'You can look at records but not change them until it is paid.', link: '/system/subscription' })),
      skipDuplicates: true,
    });
    await logPlatform(admin, {
      action: 'SCHOOL_SUSPENDED', schoolId, entityType: 'School', entityId: schoolId, detail: `${school.name}: ${reason}`,
      before: { status: school.status }, after: { status: 'SUSPENDED', reason },
    }, tx);
    return { status: 'SUSPENDED' as const };
  });
}

export async function reactivateSchool(admin: Admin, schoolId: string) {
  const school = await mustExist(schoolId);
  if (school.status !== 'SUSPENDED') throw new ServiceError('This school is not suspended', 409);
  return prisma.$transaction(async (tx) => {
    await tx.school.update({ where: { id: schoolId }, data: { status: 'ACTIVE', suspendedReason: null } });
    const ids = await accountContacts(tx, schoolId);
    await tx.notification.createMany({
      data: ids.map((userId) => ({ schoolId, userId, type: 'SUBSCRIPTION', title: 'Your subscription is active again', body: 'You can add and change records again.', link: '/system/subscription' })),
      skipDuplicates: true,
    });
    await logPlatform(admin, {
      action: 'SCHOOL_REACTIVATED', schoolId, entityType: 'School', entityId: schoolId, detail: school.name,
      before: { status: 'SUSPENDED', reason: school.suspendedReason }, after: { status: 'ACTIVE' },
    }, tx);
    return { status: 'ACTIVE' as const };
  });
}
