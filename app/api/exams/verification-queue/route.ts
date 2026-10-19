import { guarded } from '@/lib/exams/route';
import { verificationQueue } from '@/lib/exams/sheets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/verification-queue', ['exams.marks.verify', 'exams.marks.unlock'], async ({ user, query }) => verificationQueue(user, query.get('termId') ?? undefined));
