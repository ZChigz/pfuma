// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { signOut } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/sign-out', ['facilities.exeats.signout'], async ({ user, req }) => signOut(user, await body(req)));
