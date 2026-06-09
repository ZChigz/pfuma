import { z } from 'zod';

export const CreateSubjectSchema = z.object({
  name:    z.string().min(1, 'Name is required'),
  code:    z.string().min(1, 'Code is required'),
  grade:   z.string().min(1, 'Grade is required'),
  maxMark: z.number({ invalid_type_error: 'Max mark must be a number' }).int().positive(),
  type:    z.enum(['CORE', 'ELECTIVE']),
});

export const AssignTeacherSchema = z.object({
  teacherId: z.string().min(1),
  subjectId: z.string().min(1),
  term:      z.string().min(1, 'Term is required'),
});

export const EnterMarkSchema = z.object({
  studentId: z.string().min(1),
  subjectId: z.string().min(1),
  term:      z.string().min(1),
  rawMark:   z.number({ invalid_type_error: 'Mark must be a number' }).min(0),
});

export const PublishResultsSchema = z.object({
  grade: z.string().min(1, 'Grade is required'),
  term:  z.string().min(1, 'Term is required'),
});
