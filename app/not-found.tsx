import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-frame p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 text-center">
        <p className="text-6xl font-extrabold text-primary">404</p>

        <h1 className="mt-4 text-xl font-bold text-ink">Page not found</h1>
        <p className="mt-1 text-sm text-muted">
          The page you are looking for does not exist or has been moved.
        </p>

        <Link
          href="/accounting"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 mt-8"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
