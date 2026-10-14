import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'gold' | 'info';

interface BadgeProps {
  variant?: BadgeVariant;
  label: string;
  icon?: ReactNode;
  className?: string;
}

const variants: Record<BadgeVariant, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warn-bg text-warn',
  danger:  'bg-danger-bg text-danger',
  neutral: 'bg-canvas text-muted',
  gold:    'bg-warn-bg text-warn',
  info:    'bg-[#dbeafe] text-[#1d4ed8]',
};

export function Badge({ variant = 'neutral', label, icon, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      {icon && <span className="flex-shrink-0" aria-hidden="true">{icon}</span>}
      {label}
    </span>
  );
}
