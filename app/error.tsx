'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    logger.error('Unhandled render error (root)', error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-[#f5f5f4] p-6 antialiased">
        <ErrorCard reset={reset} />
      </body>
    </html>
  );
}

function ErrorCard({ reset }: { reset: () => void }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-[#e7e5e4] bg-white p-10 text-center shadow-sm">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
        <svg
          className="h-7 w-7 text-[#b91c1c]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h1 className="text-lg font-bold text-[#292524]">Something went wrong</h1>
      <p className="mt-2 text-sm text-[#78716c]">
        An unexpected error occurred. Please try again, or contact support if the
        problem persists.
      </p>

      <button
        onClick={reset}
        className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#065f46] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 focus:ring-offset-2"
      >
        Try again
      </button>
    </div>
  );
}
