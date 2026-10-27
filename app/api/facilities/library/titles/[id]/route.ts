// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { getTitle } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/titles/[id]', ['facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue'], async ({ user, params }) => getTitle(user, params.id!));
