import { z } from 'zod';

export const CreateSubjectSchema = z.object({
  name:    z.string().min(1, 'Name is required'),
  code:    z.string().min(1, 'Code is required'),
  maxMark: z.number({ invalid_type_error: 'Max mark must be a number' }).int().positive().optional(),
  type:    z.enum(['CORE', 'ELECTIVE']).optional(),
});

export const UpdateSubjectSchema = z.object({
  name:    z.string().min(1, 'Name is required').optional(),
  code:    z.string().min(1, 'Code is required').optional(),
  maxMark: z.number({ invalid_type_error: 'Max mark must be a number' }).int().positive().optional(),
  type:    z.enum(['CORE', 'ELECTIVE']).optional(),
  active:  z.boolean().optional(),
});

export const CreateAssignmentSchema = z.object({
  teacherId: z.string().min(1),
  subjectId: z.string().min(1),
  classId:   z.string().min(1, 'Class is required'),
  term:      z.string().min(1, 'Term is required'),
});

export const EnterMarkSchema = z.object({
  studentId: z.string().min(1),
  subjectId: z.string().min(1),
  classId:   z.string().min(1),
  term:      z.string().min(1),
  rawMark:   z.number({ invalid_type_error: 'Mark must be a number' }).min(0),
});

export const PublishResultsSchema = z.object({
  classId: z.string().min(1, 'Class is required'),
  term:    z.string().min(1, 'Term is required'),
});

export const VerifyMarksSchema = z.object({
  assignmentId: z.string().min(1),
  term:         z.string().min(1),
  force:        z.boolean().optional(),
});

export const UnverifyMarksSchema = z.object({
  assignmentId: z.string().min(1),
});

export const SaveBoundariesSchema = z.object({
  boundaries: z
    .array(
      z.object({
        minPercent:  z.number().min(0).max(100),
        maxPercent:  z.number().min(0).max(100),
        letterGrade: z.string().min(1).max(5),
      }),
    )
    .min(1, 'At least one boundary is required'),
});
