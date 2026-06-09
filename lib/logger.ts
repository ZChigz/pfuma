// Simple structured logger compatible with production log aggregators (Datadog,
// Papertrail, CloudWatch). In production it emits newline-delimited JSON so
// log shippers can parse fields without regex. In development it emits
// human-readable coloured output.

type LogLevel = 'info' | 'warn' | 'error';

function jsonLine(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown>,
): void {
  process.stdout.write(
    JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    }) + '\n',
  );
}

const RESET  = '\x1b[0m';
const GREY   = '\x1b[90m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';

function devLine(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown>,
): void {
  const ts      = new Date().toISOString();
  const colours: Record<LogLevel, string> = { info: CYAN, warn: YELLOW, error: RED };
  const colour  = colours[level];
  const metaStr = Object.keys(meta).length
    ? ' ' + GREY + JSON.stringify(meta) + RESET
    : '';
  // eslint-disable-next-line no-console
  console.log(`${colour}[${level.toUpperCase()}]${RESET} ${GREY}${ts}${RESET} ${message}${metaStr}`);
}

const isProd = process.env.NODE_ENV === 'production';

function buildMeta(
  base: Record<string, unknown> | undefined,
  error: unknown,
): Record<string, unknown> {
  const meta = { ...(base ?? {}) };
  if (error !== undefined) {
    if (error instanceof Error) {
      meta.error = { message: error.message, name: error.name, stack: error.stack };
    } else {
      meta.error = String(error);
    }
  }
  return meta;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    const m = buildMeta(meta, undefined);
    isProd ? jsonLine('info', message, m) : devLine('info', message, m);
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    const m = buildMeta(meta, undefined);
    isProd ? jsonLine('warn', message, m) : devLine('warn', message, m);
  },

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const m = buildMeta(meta, error);
    isProd ? jsonLine('error', message, m) : devLine('error', message, m);
  },
};
