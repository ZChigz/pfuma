// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { renewLoan } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/loans/[id]/renew', ['facilities.library.desk'], async ({ user, params }) => renewLoan(user, params.id!));
