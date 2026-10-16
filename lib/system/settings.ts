import type { AuditAction } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import type { ScopedDb } from '@/lib/scoped-db';
import type { z } from 'zod';
import type {
  FinanceSettingsSchema, NumberingSchema, SchoolDefaultsSchema, SchoolProfileSchema,
} from '@/lib/validations/system';

export const SCHOOL_PROFILE_SELECT = {
  id: true, name: true, motto: true, logoUrl: true, schoolType: true, responsibleAuthority: true, boarding: true, studentGender: true,
  offersCambridge: true, zimsecCentreNumber: true, emisNumber: true, province: true, district: true, physicalAddress: true,
  postalAddress: true, phone: true, email: true, website: true, headName: true, headSignatureUrl: true,
  // Small defaults
  maxClassSize: true, setupChecklistPinned: true,
  // Finance basics
  currencyUsdEnabled: true, currencyZigEnabled: true, defaultCurrency: true, receiptFormat: true, receiptNextNumber: true,
  invoiceFormat: true, invoiceNextNumber: true,
  // Numbering
  schoolCode: true, admissionFormat: true,
} as const;

export async function getSchoolProfile(db: ScopedDb, schoolId: string) {
  return db.school.findUnique({ where: { id: schoolId }, select: SCHOOL_PROFILE_SELECT });
}

type Actor = { id: string; schoolId: string };

const SECTIONS = {
  profile:  { label: 'School profile', action: 'UPDATE_SCHOOL_SETTINGS' },
  defaults: { label: 'Defaults', action: 'UPDATE_SCHOOL_SETTINGS' },
  finance:  { label: 'Finance basics', action: 'UPDATE_FINANCE_SETTINGS' },
  numbering: { label: 'Numbering', action: 'UPDATE_NUMBERING' },
} as const satisfies Record<string, { label: string; action: AuditAction }>;

type Section = keyof typeof SECTIONS;

async function saveSection(db: ScopedDb, actor: Actor, section: Section, data: Record<string, string | number | boolean | null>) {
  const before = await getSchoolProfile(db, actor.schoolId);
  if (!before) throw new ServiceError('School not found', 404);
  const changed = Object.keys(data).filter((k) => data[k] !== (before as Record<string, unknown>)[k]);
  const { label, action } = SECTIONS[section];

  return db.$tx(async (tx) => {
    const after = await tx.school.update({ where: { id: actor.schoolId }, data, select: SCHOOL_PROFILE_SELECT });
    // Only the fields of this section go into the log, so one tab's change does not drag the others along.
    const pick = (row: Record<string, unknown>) => Object.fromEntries(Object.keys(data).map((k) => [k, row[k] ?? null]));
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action, entityType: 'School', entityId: actor.schoolId,
        detail: changed.length ? `${label}: changed ${changed.join(', ')}` : `${label}: saved with no changes`,
        before: pick(before) as never, after: pick(after) as never,
      },
      tx,
    );
    return after;
  });
}

export async function updateSchoolProfile(db: ScopedDb, actor: Actor, input: z.output<typeof SchoolProfileSchema>) {
  return saveSection(db, actor, 'profile', {
    name: input.name,
    motto: input.motto ?? null,
    logoUrl: input.logoUrl ?? null,
    schoolType: input.schoolType,
    responsibleAuthority: input.responsibleAuthority ?? null,
    boarding: input.boarding,
    studentGender: input.studentGender,
    offersCambridge: input.offersCambridge,
    zimsecCentreNumber: input.zimsecCentreNumber ?? null,
    emisNumber: input.emisNumber ?? null,
    province: input.province ?? null,
    district: input.district,
    physicalAddress: input.physicalAddress,
    postalAddress: input.postalAddress ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    headName: input.headName ?? null,
    headSignatureUrl: input.headSignatureUrl ?? null,
  });
}

/** Only the fields that were sent change. */
export async function updateSchoolDefaults(db: ScopedDb, actor: Actor, input: z.output<typeof SchoolDefaultsSchema>) {
  const data: Record<string, number | boolean> = {};
  if (input.maxClassSize !== undefined) data.maxClassSize = input.maxClassSize;
  if (input.setupChecklistPinned !== undefined) data.setupChecklistPinned = input.setupChecklistPinned;
  return saveSection(db, actor, 'defaults', data);
}

export async function updateFinanceSettings(db: ScopedDb, actor: Actor, input: z.output<typeof FinanceSettingsSchema>) {
  return saveSection(db, actor, 'finance', {
    currencyUsdEnabled: input.currencyUsdEnabled,
    currencyZigEnabled: input.currencyZigEnabled,
    defaultCurrency: input.defaultCurrency,
    receiptFormat: input.receiptFormat,
    receiptNextNumber: input.receiptNextNumber,
    invoiceFormat: input.invoiceFormat,
    invoiceNextNumber: input.invoiceNextNumber,
  });
}

export async function updateNumberingSettings(db: ScopedDb, actor: Actor, input: z.output<typeof NumberingSchema>) {
  return saveSection(db, actor, 'numbering', { schoolCode: input.schoolCode, admissionFormat: input.admissionFormat });
}
