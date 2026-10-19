import { guarded, body } from '@/lib/exams/route';
import { pullSchoolCandidates } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/board/sessions/[id]/pull', 'exams.zimsec.manage', async ({ user, req, params }) => pullSchoolCandidates(user, params.id!, await body(req).catch(() => ({}))));
