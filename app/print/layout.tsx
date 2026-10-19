import type { ReactNode } from 'react';

// Printed pages (A4) sit outside the dashboard shell so nothing around them is clipped or printed.
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-white p-4 text-ink print:p-0">{children}</div>;
}
