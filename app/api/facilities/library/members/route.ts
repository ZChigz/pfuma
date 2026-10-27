// Asks can() first; the service behind it checks the permission again and every library rule.
import { guarded } from '@/lib/finance/route';
import { findMember } from '@/lib/facilities/library';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/library/members', ['facilities.library.desk', 'facilities.library.manage', 'facilities.textbooks.issue', 'facilities.library.view'], async ({ user, query }) => findMember(user, query.get('code') ?? ''));
