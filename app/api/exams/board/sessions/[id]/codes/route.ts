import { guarded, body } from '@/lib/exams/route';
import { listCodes, saveCodes } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/board/sessions/[id]/codes', ['exams.zimsec.manage', 'exams.zimsec.approve', 'exams.zimsec.results_import'], async ({ user, params }) => listCodes(user, params.id!));
export const PUT = guarded('PUT /api/exams/board/sessions/[id]/codes', 'exams.zimsec.manage', async ({ user, req, params }) => saveCodes(user, params.id!, await body(req)));
