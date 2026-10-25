// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { listTitles, saveTitle } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/titles', ['facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue'], async ({ user, query }) => listTitles(user, { q: query.get('q') || undefined, category: query.get('category') || undefined, page: Number(query.get('page')) || undefined }));
export const POST = guarded('POST /api/facilities/library/titles', ['facilities.library.manage'], async ({ user, req }) => saveTitle(user, await body(req)), 201);
