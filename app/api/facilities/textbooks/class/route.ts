// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { classIssueSheet } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/textbooks/class', ['facilities.textbooks.issue', 'facilities.library.manage', 'facilities.library.view'], async ({ user, query }) => classIssueSheet(user, query.get('classId') ?? '', query.get('setId') || undefined));
