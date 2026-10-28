// The Facilities overview cards. Any facilities permission may ask; each card needs its own part's permission and switch.
import { guarded } from '@/lib/finance/route';
import { ANY_FACILITIES } from '@/lib/facilities/people';
import { facilitiesOverview } from '@/lib/facilities/overview';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/overview', ANY_FACILITIES, async ({ user }) => facilitiesOverview(user));
