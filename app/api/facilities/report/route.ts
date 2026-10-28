// Figures across the parts for a period. Any facilities permission may ask; each section needs its own part's permission and switch.
import { guarded } from '@/lib/finance/route';
import { ANY_FACILITIES } from '@/lib/facilities/people';
import { facilitiesReport } from '@/lib/facilities/overview';

export const runtime = 'nodejs';

export const GET = guarded('GET /api/facilities/report', ANY_FACILITIES, async ({ user, query }) => facilitiesReport(user, { from: query.get('from') || undefined, to: query.get('to') || undefined }));
