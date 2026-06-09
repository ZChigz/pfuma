'use client';

import { cn } from '@/lib/utils';
import { create } from 'zustand';
import { useEffect, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (message: string, type: ToastType) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (message, type) =>
    set((s) => ({
      toasts: [...s.toasts, { id: crypto.randomUUID(), message, type }],
    })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (message: string) => useToastStore.getState().add(message, 'success'),
  error:   (message: string) => useToastStore.getState().add(message, 'error'),
  info:    (message: string) => useToastStore.getState().add(message, 'info'),
};

export function useToast() {
  return toast;
}

const typeStyles: Record<ToastType, string> = {
  success: 'bg-[#065f46]',
  error:   'bg-[#b91c1c]',
  info:    'bg-[#292524]',
};

function ToastItemComponent({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-w-[280px] items-center justify-between gap-4 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg',
        typeStyles[item.type],
      )}
    >
      <span>{item.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 opacity-80 transition-opacity hover:opacity-100"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, remove } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItemComponent key={t.id} item={t} onDismiss={() => remove(t.id)} />
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastContainer />
    </>
  );
}
