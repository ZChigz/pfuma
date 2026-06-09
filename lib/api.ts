import { NextResponse } from 'next/server';
import { ZodError, type ZodSchema } from 'zod';
import { logger } from '@/lib/logger';

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, message }, { status });
}

export function apiUnauthorized(): NextResponse {
  return apiError('Unauthorized', 401);
}

export function apiForbidden(): NextResponse {
  return apiError('Forbidden', 403);
}

export function apiNotFound(entity = 'Resource'): NextResponse {
  return apiError(`${entity} not found`, 404);
}

export function apiValidationError(errors: ZodError): NextResponse {
  return NextResponse.json(
    {
      success: false,
      message: 'Validation failed',
      errors: errors.flatten().fieldErrors,
    },
    { status: 422 },
  );
}

// ─── Route error wrapper ─────────────────────────────────────────────────────
// Catches any unhandled error thrown inside a route handler, logs it with
// structured context, and returns a clean 500 response instead of bubbling
// up to Next.js's default handler.

type NextHandler = (req: Request, ctx?: unknown) => Promise<Response>;

export function withApi(label: string, handler: NextHandler): NextHandler {
  return async (req: Request, ctx?: unknown) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      logger.error(`Unhandled route error: ${label}`, err, { url: req.url });
      return NextResponse.json(
        { success: false, message: 'Internal server error' },
        { status: 500 },
      );
    }
  };
}

export async function parseBody<T>(
  req: Request,
  schema: ZodSchema<T>,
): Promise<{ data: T } | { error: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: apiError('Invalid JSON', 400) };
  }

  try {
    return { data: schema.parse(body) };
  } catch (e) {
    if (e instanceof ZodError) return { error: apiValidationError(e) };
    throw e;
  }
}
