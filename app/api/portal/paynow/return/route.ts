// Public: where Paynow sends the guardian back to. Settles the payment by asking Paynow, then shows a plain page.
import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api';
import { pollPaynow } from '@/lib/finance/paynow';

export const runtime = 'nodejs';

export const GET = withApi('GET /api/portal/paynow/return', async (req: Request) => {
  const ref = new URL(req.url).searchParams.get('ref') ?? '';
  const r = /^PFM-[0-9A-F]{12}$/.test(ref) ? await pollPaynow(ref).catch(() => ({ status: 'UNKNOWN' })) : { status: 'UNKNOWN' };
  const msg = r.status === 'PAID' ? 'Payment received. Thank you. You may close this page.' : 'We have not yet heard from Paynow. If you paid, the school will receive it shortly.';
  return new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title><body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">School fees payment</h1><p>${msg}</p>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
});
