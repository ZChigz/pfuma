import { guarded, body } from '@/lib/exams/route';
import { startCommonProject } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/exams/projects/start-common', 'exams.projects.manage', async ({ user, req }) => startCommonProject(user, await body(req)), 201);
