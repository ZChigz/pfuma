import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'gold';

interface BadgeProps {
  variant?: BadgeVariant;
  label: string;
  icon?: ReactNode;
  className?: string;
}

const variants: Record<BadgeVariant, string> = {
  success: 'bg-[#dcfce7] text-[#15803d]',
  warning: 'bg-[#fef9c3] text-[#b45309]',
  danger:  'bg-[#fee2e2] text-[#b91c1c]',
  neutral: 'bg-[#f5f5f4] text-[#78716c]',
  gold:    'bg-[#fef3c7] text-[#b45309]',
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
