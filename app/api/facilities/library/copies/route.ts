// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded, body } from '@/lib/finance/route';
import { addCopies, updateCopy } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const POST = guarded('POST /api/facilities/library/copies', ['facilities.library.manage'], async ({ user, req }) => addCopies(user, await body(req)), 201);
export const PATCH = guarded('PATCH /api/facilities/library/copies', ['facilities.library.manage'], async ({ user, req }) => updateCopy(user, await body(req)));
