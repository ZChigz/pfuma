// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { markTextbooksMissing } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/textbooks/missing', ['facilities.textbooks.issue'], async ({ user, req }) => markTextbooksMissing(user, await body(req)));
