// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded } from '@/lib/finance/route';
import { findByTag } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/tag', ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'], async ({ user, query }) => findByTag(user, query.get('tag') ?? ''));
