/// <reference types="vite/client" />
// Calls an API route handler directly, as a given signed-in user.
import { NextRequest } from 'next/server';
import { session } from './session';
import type { SeededUser } from './seed';

const modules = import.meta.glob('../../app/api/**/route.ts') as Record<string, () => Promise<Record<string, unknown>>>;

export interface CallOptions {
  as?: SeededUser | null;
  query?: string;               // e.g. "?termId=abc"
  params?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
  response: Response;
}

export async function call(
  file: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  opts: CallOptions = {},
): Promise<CallResult> {
  session.current = opts.as ? { ...opts.as } : null;
  const loader = modules[`../../app/api/${file}/route.ts`];
  if (!loader) throw new Error(`No route file app/api/${file}/route.ts`);
  const mod = await loader();
  const handler = mod[method] as ((req: Request, ctx?: unknown) => Promise<Response>) | undefined;
  if (!handler) throw new Error(`app/api/${file} has no ${method}`);

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const init: RequestInit = { method };
  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody;
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  init.headers = headers;
  const req = new NextRequest(`http://localhost/api/${file}${opts.query ?? ''}`, init as never);
  const response = await handler(req, { params: opts.params ?? {} });
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text, response };
}
