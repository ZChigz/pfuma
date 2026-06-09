import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  noPadding?: boolean;
  className?: string;
}

export function Card({
  title,
  subtitle,
  children,
  action,
  noPadding = false,
  className,
}: CardProps) {
  const hasHeader = title || subtitle || action;

  return (
    <div
      className={cn(
        'rounded-xl border border-[#e7e5e4] bg-white shadow-sm',
        className,
      )}
    >
      {hasHeader && (
        <div className="flex items-start justify-between border-b border-[#e7e5e4] px-6 py-4">
          <div>
            {title && (
              <h3 className="text-base font-semibold text-[#292524]">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-[#78716c]">{subtitle}</p>
            )}
          </div>
          {action && <div className="ml-4 flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-6'}>{children}</div>
    </div>
  );
}
