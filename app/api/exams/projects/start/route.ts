import { guarded, body } from '@/lib/exams/route';
import { startProject } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/projects/start', 'exams.assessments.create', async ({ user, req }) => startProject(user, await body(req)), 201);
