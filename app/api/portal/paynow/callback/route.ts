// Public: Paynow posts the result of a payment here. The hash is checked against the school's integration key before anything is recorded.
import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api';
import { paynowCallback } from '@/lib/finance/paynow';

export const runtime = 'nodejs';

export const POST = withApi('POST /api/portal/paynow/callback', async (req: Request) => {
  await paynowCallback(new URLSearchParams(await req.text()));
  return new NextResponse('OK', { status: 200 });
});
