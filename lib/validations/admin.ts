import { z } from 'zod';

export const CreateUserSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email:    z.string().email('Invalid email address'),
  role:     z.enum(['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN']),
});

const capacity = z
  .number({ error: 'Capacity must be a number' })
  .int('Capacity must be a whole number')
  .min(1, 'Capacity must be at least 1')
  .max(200, 'Capacity must be 200 or fewer');

const stream = z
  .string()
  .trim()
  .max(30, 'Stream must be 30 characters or fewer')
  .regex(/^[A-Za-z0-9 ]*$/, 'Stream can only contain letters, numbers and spaces');

export const CreateClassSchema = z.object({
  levelId:        z.string().min(1, 'Level is required'),
  stream:         stream.optional().default(''),
  capacity:       capacity.optional(),
  classTeacherId: z.string().optional(),
});

export const UpdateClassSchema = z.object({
  levelId:        z.string().min(1).optional(),
  stream:         stream.optional(),
  capacity:       capacity.optional(),
  classTeacherId: z.string().nullable().optional(),
  active:         z.boolean().optional(),
});

// Student admission rules live in lib/students/registration.ts; lifecycle and
// calendar schemas in lib/validations/academic.ts.

export const UpdateSchoolSettingsSchema = z.object({
  maxClassSize: z
    .number({ error: 'Default class capacity must be a number' })
    .int('Default class capacity must be a whole number')
    .min(1, 'Default class capacity must be at least 1')
    .max(200, 'Default class capacity must be 200 or fewer'),
});

export const BulkApplyFeesSchema = z
  .object({
    scope:          z.enum(['class', 'level']),
    classId:        z.string().optional(),
    levelId:        z.string().optional(),
    feeStructureId: z.string().min(1, 'Fee structure is required'),
    termId:         z.string().min(1, 'Term is required'),
  })
  .refine((d) => (d.scope === 'class' ? !!d.classId : !!d.levelId), {
    message: 'Choose a class or a level',
    path: ['scope'],
  });
