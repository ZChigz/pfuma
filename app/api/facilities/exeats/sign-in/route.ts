// Asks can() first; the service behind it checks the permission again and every exeats rule.
import { guarded, body } from '@/lib/finance/route';
import { signIn } from '@/lib/facilities/exeats';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/exeats/sign-in', ['facilities.exeats.signout'], async ({ user, req }) => signIn(user, await body(req)));
