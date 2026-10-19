import { guarded, body } from '@/lib/exams/route';
import { listTemplates, createTemplate } from '@/lib/exams/projects';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/exams/projects', ['exams.projects.manage', 'exams.assessments.create'], async ({ user, query }) => listTemplates(user, { subjectId: query.get('subjectId') ?? undefined, levelId: query.get('levelId') ?? undefined }));
export const POST = guarded('POST /api/exams/projects', 'exams.projects.manage', async ({ user, req }) => createTemplate(user, await body(req)), 201);
