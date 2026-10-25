// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { listTextbookSets, saveTextbookSet } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/textbooks/sets', ['facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue'], async ({ user }) => listTextbookSets(user));
export const POST = guarded('POST /api/facilities/textbooks/sets', ['facilities.library.manage', 'facilities.textbooks.issue'], async ({ user, req }) => saveTextbookSet(user, await body(req)), 201);
