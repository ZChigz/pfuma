import { guarded, body } from '@/lib/exams/route';
import { addEvidence } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/evidence', 'exams.marks.enter', async ({ user, req }) => addEvidence(user, await body(req)), 201);
