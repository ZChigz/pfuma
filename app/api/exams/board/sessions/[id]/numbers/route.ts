import { guarded, body } from '@/lib/exams/route';
import { importCandidateNumbers } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/board/sessions/[id]/numbers', 'exams.zimsec.manage', async ({ user, req, params }) => importCandidateNumbers(user, params.id!, await body(req)));
