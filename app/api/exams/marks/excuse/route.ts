import { guarded, body } from '@/lib/exams/route';
import { excuseAbsence } from '@/lib/exams/marks';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/marks/excuse', 'exams.marks.unlock', async ({ user, req }) => excuseAbsence(user, await body(req)));
