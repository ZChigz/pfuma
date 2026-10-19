import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata = { title: 'Pfuma Platform' };

// The Pfuma staff console. It has its own sign-in and nothing here is a school page.
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas text-ink">{children}</div>
    </ToastProvider>
  );
}
