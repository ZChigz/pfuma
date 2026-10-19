import { guarded, body } from '@/lib/exams/route';
import { listSessions, saveSession } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/board/sessions', ['exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view'], async ({ user }) => listSessions(user));
export const POST = guarded('POST /api/exams/board/sessions', 'exams.zimsec.manage', async ({ user, req }) => saveSession(user, await body(req)), 201);
