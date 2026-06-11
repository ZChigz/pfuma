import { z } from 'zod';

export const CreateUserSchema = z.object({
  fullName: z.string().min(1, 'Full name is required'),
  email:    z.string().email('Invalid email address'),
  role:     z.enum(['ADMIN', 'DIRECTOR', 'HEAD', 'BURSAR', 'TEACHER', 'LIBRARIAN']),
});

export const CreateClassSchema = z.object({
  grade:          z.string().min(1, 'Grade is required'),
  section:        z.string().optional(),
  classTeacherId: z.string().optional(),
});

export const UpdateClassSchema = z.object({
  grade:          z.string().min(1).optional(),
  section:        z.string().nullable().optional(),
  classTeacherId: z.string().nullable().optional(),
  active:         z.boolean().optional(),
});

export const CreateAdminStudentSchema = z.object({
  fullName:    z.string().min(1, 'Full name is required'),
  classId:     z.string().min(1, 'Class is required'),
  parentName:  z.string().min(1, 'Parent/guardian name is required'),
  parentPhone: z.string().min(1, 'Parent phone is required'),
});

export const MoveStudentsSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1, 'Select at least one student'),
  classId:    z.string().min(1, 'Class is required'),
});

export const BulkApplyFeesSchema = z
  .object({
    scope:          z.enum(['class', 'grade']),
    classId:        z.string().optional(),
    grade:          z.string().optional(),
    feeStructureId: z.string().min(1, 'Fee structure is required'),
    term:           z.string().min(1, 'Term is required'),
  })
  .refine((d) => (d.scope === 'class' ? !!d.classId : !!d.grade), {
    message: 'classId is required when scope is "class", grade is required when scope is "grade"',
    path: ['scope'],
  });
