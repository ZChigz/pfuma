'use client';

import { Button } from '@/components/ui/Button';

/** Opens the browser's print dialog (the page has print styles: A4, no menus). */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return <Button size="sm" variant="secondary" onClick={() => window.print()}>{label}</Button>;
}
