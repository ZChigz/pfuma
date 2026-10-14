import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f6f4] p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 text-center">
        <p className="text-6xl font-extrabold text-[#14613f]">404</p>

        <h1 className="mt-4 text-xl font-bold text-[#14301f]">Page not found</h1>
        <p className="mt-2 text-sm text-[#6b7a70]">
          The page you are looking for does not exist or has been moved.
        </p>

        <Link
          href="/accounting"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-[#14613f] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0f4d32] focus:outline-none focus:ring-2 focus:ring-[#14613f]/40 focus:ring-offset-2"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
