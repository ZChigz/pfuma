import { guarded, body } from '@/lib/exams/route';
import { addPrivateCandidate } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/board/sessions/[id]/private', 'exams.zimsec.manage', async ({ user, req, params }) => addPrivateCandidate(user, params.id!, await body(req)), 201);
