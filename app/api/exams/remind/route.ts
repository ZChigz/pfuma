import { guarded, body } from '@/lib/exams/route';
import { remindTeachers } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/remind', ['exams.marks.unlock', 'exams.setup.manage'], async ({ user, req }) => remindTeachers(user, await body(req)));
