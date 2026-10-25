// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { textbookCard } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/textbooks/card', ['facilities.textbooks.issue', 'facilities.library.manage', 'facilities.library.view', 'facilities.library.desk'], async ({ user, query }) => textbookCard(user, query.get('studentId') ?? ''));
