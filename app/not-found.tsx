import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f4] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#e7e5e4] bg-white p-10 text-center shadow-sm">
        <p className="text-6xl font-extrabold text-[#065f46]">404</p>

        <h1 className="mt-4 text-xl font-bold text-[#292524]">Page not found</h1>
        <p className="mt-2 text-sm text-[#78716c]">
          The page you are looking for does not exist or has been moved.
        </p>

        <Link
          href="/accounting"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#065f46] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#047857] focus:outline-none focus:ring-2 focus:ring-[#065f46]/40 focus:ring-offset-2"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
