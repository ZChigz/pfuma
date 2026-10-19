import { guarded, body } from '@/lib/exams/route';
import { entryList, saveSession } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/board/sessions/[id]', ['exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import', 'exams.analytics.view'], async ({ user, params }) => entryList(user, params.id!));
export const PATCH = guarded('PATCH /api/exams/board/sessions/[id]', 'exams.zimsec.manage', async ({ user, req, params }) => saveSession(user, await body(req), params.id!));
