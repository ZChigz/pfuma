// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { issueTextbooks } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/textbooks/issue', ['facilities.textbooks.issue'], async ({ user, req }) => issueTextbooks(user, await body(req)), 201);
