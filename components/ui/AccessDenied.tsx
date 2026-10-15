import Link from 'next/link';

/** Shown instead of a page when can() says no. */
export function AccessDenied({ message }: { message?: string }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-danger" aria-hidden="true">
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-ink">You do not have access to this page</h1>
      <p className="text-sm text-muted">{message ?? 'Ask a school administrator if you need it.'}</p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
