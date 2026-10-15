import { z } from 'zod';

export const CreateSubjectSchema = z.object({
  name:    z.string().min(1, 'Name is required'),
  code:    z.string().min(1, 'Code is required'),
  maxMark: z.number({ error: 'Max mark must be a number' }).int().positive().optional(),
  type:    z.enum(['CORE', 'ELECTIVE']).optional(),
});

export const UpdateSubjectSchema = z.object({
  name:    z.string().min(1, 'Name is required').optional(),
  code:    z.string().min(1, 'Code is required').optional(),
  maxMark: z.number({ error: 'Max mark must be a number' }).int().positive().optional(),
  type:    z.enum(['CORE', 'ELECTIVE']).optional(),
  active:  z.boolean().optional(),
});

export const CreateAssignmentSchema = z.object({
  teacherId: z.string().min(1, 'Teacher is required'),
  subjectId: z.string().min(1, 'Subject is required'),
  classId:   z.string().min(1, 'Class is required'),
  termId:    z.string().min(1, 'Term is required'),
});

export const EnterMarkSchema = z.object({
  studentId: z.string().min(1),
  subjectId: z.string().min(1),
  classId:   z.string().min(1),
  termId:    z.string().min(1),
  rawMark:   z.number({ error: 'Mark must be a number' }).min(0),
});

export const PublishResultsSchema = z.object({
  classId: z.string().min(1, 'Class is required'),
  termId:  z.string().min(1, 'Term is required'),
});

export const VerifyMarksSchema = z.object({
  assignmentId: z.string().min(1),
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

export const UnpublishResultsSchema = z.object({
  classId: z.string().min(1, 'Class is required'),
  termId:  z.string().min(1, 'Term is required'),
  reason:  z.string().trim().min(10, 'Give a reason of at least 10 characters'),
  // true: also unlock the marks for teachers to edit; false: marks stay locked (verified).
  unlockMarks: z.boolean().optional().default(false),
});
