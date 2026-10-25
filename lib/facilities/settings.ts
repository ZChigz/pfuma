// The school's Facilities settings: loan rules, fine per day, alert times and the value limits above which a second person must approve.
// Each setting belongs to a part and needs that part's "manage" permission (or the key named for it).
import { z } from 'zod';
import type { FacSettings } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import type { PermissionKey } from '@/lib/access-core';
import { getScopedDb } from '@/lib/scoped-db';
import { audit, loadFacSettings, need, partOn, type Actor } from '@/lib/facilities/common';

const n = (max: number, min = 0) => z.number().int().min(min).max(max);
const SESSIONS = z.enum(['MORNING', 'EVENING', 'LIGHTS_OUT']);

/** Field -> the part it belongs to and the permission that changes it. */
const FIELDS = {
  rollCallSessions:           { part: 'hostel',    key: 'facilities.hostel.manage',      schema: z.array(SESSIONS).min(1, 'Choose at least one roll call session').max(3) },
  exeatHeadAlertMinutes:      { part: 'exeats',    key: 'facilities.hostel.manage',      schema: n(1440) },
  longExeatNights:            { part: 'exeats',    key: 'facilities.hostel.manage',      schema: n(60) },
  learnerMaxLoans:            { part: 'library',   key: 'facilities.library.manage',     schema: n(50) },
  learnerLoanDays:            { part: 'library',   key: 'facilities.library.manage',     schema: n(365, 1) },
  staffMaxLoans:              { part: 'library',   key: 'facilities.library.manage',     schema: n(100) },
  staffLoanDays:              { part: 'library',   key: 'facilities.library.manage',     schema: n(365, 1) },
  lateFinePerDayCents:        { part: 'library',   key: 'facilities.library.manage',     schema: n(1_000_000) },
  lateFineCurrency:           { part: 'library',   key: 'facilities.library.manage',     schema: z.enum(['USD', 'ZIG']) },
  prorateTransport:           { part: 'transport', key: 'facilities.transport.manage',   schema: z.boolean() },
  adjustmentLimitUsdCents:    { part: 'inventory', key: 'facilities.inventory.writeoff', schema: n(2_000_000_000) },
  adjustmentLimitZigCents:    { part: 'inventory', key: 'facilities.inventory.writeoff', schema: n(2_000_000_000) },
  expiryWarningDays:          { part: 'inventory', key: 'facilities.inventory.manage',   schema: n(365) },
  disposalOwnerLimitUsdCents: { part: 'assets',    key: 'facilities.assets.dispose',     schema: n(2_000_000_000) },
  disposalOwnerLimitZigCents: { part: 'assets',    key: 'facilities.assets.dispose',     schema: n(2_000_000_000) },
  walletLowBalanceCents:      { part: 'tuckshop',  key: 'facilities.wallets.manage',     schema: n(2_000_000_000) },
} as const satisfies Record<string, { part: string; key: PermissionKey; schema: z.ZodType }>;

type FieldName = keyof typeof FIELDS;
const PatchSchema = z.object(Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.schema.optional()]))).strict();

const view = (s: FacSettings) => Object.fromEntries(Object.keys(FIELDS).map((k) => [k, s[k as FieldName]]));

/** Anyone who holds a Facilities key may read the settings of the parts that are on. */
export async function getFacSettings(user: Actor) {
  need(user, 'facilities.hostel.view', 'facilities.hostel.manage', 'facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.inventory.view',
    'facilities.inventory.manage', 'facilities.assets.view', 'facilities.assets.manage', 'facilities.transport.manage', 'facilities.wallets.view', 'facilities.wallets.manage', 'facilities.exeats.signout', 'facilities.exeats.approve');
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => view(await loadFacSettings(tx, user.schoolId)));
}

export async function updateFacSettings(user: Actor, input: unknown) {
  const patch = PatchSchema.parse(input) as Partial<Record<FieldName, unknown>>;
  const names = (Object.keys(patch) as FieldName[]).filter((k) => patch[k] !== undefined);
  if (names.length === 0) throw new ServiceError('Nothing to change', 422);
  for (const k of names) need(user, FIELDS[k].key);

  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    for (const k of names) {
      if (!(await partOn(tx, user.schoolId, FIELDS[k].part))) throw new ServiceError('That part of Facilities & Operations is switched off for this school', 404);
    }
    const before = await loadFacSettings(tx, user.schoolId);
    const data = Object.fromEntries(names.map((k) => [k, patch[k]]));
    const after = await tx.facSettings.update({ where: { schoolId: user.schoolId }, data });
    const changed = names.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length > 0) {
      await audit(tx, user, 'FAC_SAVE_SETTINGS', 'FacSettings', after.id, `Changed ${changed.join(', ')}`,
        Object.fromEntries(changed.map((k) => [k, before[k]])) as never, Object.fromEntries(changed.map((k) => [k, after[k]])) as never);
    }
    return view(after);
  });
}
