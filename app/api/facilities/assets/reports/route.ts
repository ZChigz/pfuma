// Asks can() first; the service behind it checks the permission again and every asset rule.
import { guarded } from '@/lib/finance/route';
import { assetReports } from '@/lib/facilities/assets';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/assets/reports', ['facilities.assets.view', 'facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify'], async ({ user }) => assetReports(user));
