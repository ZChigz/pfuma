import { z } from 'zod';
import { isRealIsoDate, normalizeZimMobile, RELATIONSHIPS } from '@/lib/students/registration';

const isoDate = (label: string) =>
  z.string({ error: `${label} is required` }).refine(isRealIsoDate, { message: `${label} must be a real date (YYYY-MM-DD)` });

export const CreateAcademicYearSchema = z.object({
  year: z.number({ error: 'Year must be a number' }).int().min(2000, 'Year must be 2000 or later').max(2100, 'Year must be 2100 or earlier'),
  startDate: isoDate('Start date').optional(),
  endDate: isoDate('End date').optional(),
});

export const UpdateTermDatesSchema = z.object({
  startDate: isoDate('Start date'),
  endDate: isoDate('End date'),
});

const studentIds = z.array(z.string().min(1)).min(1, 'Select at least one student').max(500, 'Select 500 students or fewer');

export const MoveStudentsSchema = z.object({
  studentIds,
  classId: z.string().min(1, 'Class is required'),
});

export const LifecycleActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('PROMOTE'), studentIds, sourceTermId: z.string().optional(), targetClassId: z.string().optional() }),
  z.object({ action: z.literal('REPEAT'), studentIds, sourceTermId: z.string().optional(), targetClassId: z.string().optional() }),
  z.object({ action: z.literal('GRADUATE'), studentIds, reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('TRANSFER_OUT'), studentIds, reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('WITHDRAW'), studentIds, reason: z.string().max(200).optional() }),
]);

const phone = (label: string) =>
  z.string().transform((v, ctx) => {
    const n = normalizeZimMobile(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a Zimbabwean mobile number starting with 071, 073, 077, 078 or +263` });
      return z.NEVER;
    }
    return n;
  });

const optionalPhone = (label: string) =>
  z.union([z.literal(''), z.null(), phone(label)]).optional().transform((v) => v || null);

export const GuardianDetailsSchema = z.object({
  fullName: z.string().trim().min(2, 'Guardian name must be at least 2 characters').max(80),
  phone: phone('Phone'),
  altPhone: optionalPhone('Alternative phone'),
  email: z.union([z.literal(''), z.null(), z.string().trim().email('Email must look like name@example.com')]).optional().transform((v) => v || null),
  nationalId: z.string().trim().max(20).optional().transform((v) => v || null),
  address: z.string().trim().max(200).optional().transform((v) => v || null),
  occupation: z.string().trim().max(60).optional().transform((v) => v || null),
});

export const AddGuardianSchema = GuardianDetailsSchema.extend({
  relationship: z.enum(RELATIONSHIPS, { error: 'Please choose a relationship' }),
  relationshipNote: z.string().trim().max(30).optional(),
  isPrimary: z.boolean().optional(),
  isFeePayer: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
});

export const UpdateGuardianLinkSchema = z.object({
  makePrimary: z.literal(true).optional(),
  relationship: z.enum(RELATIONSHIPS).optional(),
  relationshipNote: z.string().trim().max(30).nullable().optional(),
  isFeePayer: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
});
