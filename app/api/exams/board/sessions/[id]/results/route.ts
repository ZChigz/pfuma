import { guarded, body } from '@/lib/exams/route';
import { importResults } from '@/lib/exams/board';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/board/sessions/[id]/results', 'exams.zimsec.results_import', async ({ user, req, params }) => importResults(user, params.id!, await body(req)));
