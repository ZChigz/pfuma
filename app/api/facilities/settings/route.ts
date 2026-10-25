// The school's Facilities settings. The route asks can() first; the service checks the permission of each setting again.
import { guarded, body } from '@/lib/finance/route';
import { getFacSettings, updateFacSettings } from '@/lib/facilities/settings';

export const runtime = 'nodejs';

const ANY = [
  'facilities.hostel.view', 'facilities.hostel.manage', 'facilities.library.view', 'facilities.library.manage', 'facilities.library.desk', 'facilities.inventory.view',
  'facilities.inventory.manage', 'facilities.assets.view', 'facilities.assets.manage', 'facilities.transport.manage', 'facilities.wallets.view', 'facilities.wallets.manage',
  'facilities.exeats.signout', 'facilities.exeats.approve',
] as const;

export const GET = guarded('GET /api/facilities/settings', [...ANY], async ({ user }) => getFacSettings(user));

export const PATCH = guarded(
  'PATCH /api/facilities/settings',
  ['facilities.hostel.manage', 'facilities.library.manage', 'facilities.transport.manage', 'facilities.inventory.manage', 'facilities.inventory.writeoff', 'facilities.assets.dispose', 'facilities.wallets.manage'],
  async ({ user, req }) => updateFacSettings(user, await body(req)),
);
