// Generated from the HR route list: each route asks can() first, then the service checks the permission and every rule again.
import { guarded, body } from '@/lib/finance/route';
import * as rec from '@/lib/hr/recruitment';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/hr/posts', ["hr.posts.manage","hr.posts.approve","hr.directory.view","hr.reports.view"], async ({ user }) => rec.listPosts(user));
export const POST = guarded('POST /api/hr/posts', ["hr.posts.manage"], async ({ user, req }) => rec.requestPost(user, await body(req)), 201);
