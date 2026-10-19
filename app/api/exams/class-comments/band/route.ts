import { guarded, body } from '@/lib/exams/route';
import { applyBandRemark } from '@/lib/exams/publish';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/class-comments/band', 'exams.comments.head', async ({ user, req }) => applyBandRemark(user, await body(req)));
