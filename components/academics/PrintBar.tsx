'use client';

// The bar at the top of a printed page: Print and Close, hidden on paper. `landscape` sets the paper for this page.
export function PrintBar({ title, landscape = false }: { title: string; landscape?: boolean }) {
  return (
    <>
      <style>{`@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; } @media print { body { background: white !important; } }`}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-4 py-3 print:hidden">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover">Print</button>
          <button type="button" onClick={() => window.close()} className="inline-flex min-h-[44px] items-center rounded-full border border-primary px-5 text-sm font-semibold text-primary hover:bg-tint">Close</button>
        </div>
      </div>
    </>
  );
}
