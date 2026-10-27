// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { libraryReports } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/reports', ['facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue'], async ({ user, query }) => libraryReports(user, { from: query.get('from') || undefined, to: query.get('to') || undefined }));
