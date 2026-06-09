export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Brand panel */}
      <div className="flex flex-col items-center justify-center bg-[#065f46] px-10 py-16 text-white md:w-[40%]">
        <div className="max-w-xs text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
            Welcome to
          </p>
          <h1 className="mt-2 text-5xl font-bold tracking-tight">Pfuma</h1>
          <p className="mt-3 text-lg text-emerald-100">School Management System</p>
          <div className="mx-auto mt-8 h-px w-16 bg-emerald-600" />
          <p className="mt-6 text-sm leading-relaxed text-emerald-200">
            Manage finances, results, assets, and your library — all in one place.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-8 py-16 md:w-[60%]">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
