export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-frame md:p-5">
      <div className="flex min-h-screen flex-col gap-3 bg-white p-3 md:min-h-[calc(100vh-40px)] md:flex-row md:rounded-[28px] md:shadow-[0_24px_60px_-24px_rgba(20,48,31,0.35)]">
        {/* Brand panel */}
        <div className="term-card relative flex flex-col justify-between overflow-hidden rounded-2xl p-8 text-white md:w-[44%] md:p-12">
          <div className="relative flex items-center gap-2.5">
            <svg className="h-9 w-9" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="14" stroke="#ffffff" strokeWidth="3.5" />
              <circle cx="16" cy="16" r="6" fill="#ffffff" />
            </svg>
            <span className="text-2xl font-bold tracking-tight">Pfuma</span>
          </div>

          <div className="relative my-12 max-w-sm md:my-0">
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl">
              Fees, results and records in one place.
            </h1>
            <p className="mt-5 text-base leading-relaxed text-emerald-100/90">
              Collect payments, publish term results, track assets and run the library without switching tools.
            </p>
          </div>

          <p className="relative hidden text-sm text-emerald-100/70 md:block">School management system</p>
        </div>

        {/* Form panel */}
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl bg-canvas px-6 py-14 md:px-10">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 md:p-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
