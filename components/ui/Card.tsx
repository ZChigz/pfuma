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
        'rounded-2xl bg-white',
        className,
      )}
    >
      {hasHeader && (
        <div className="flex items-start justify-between px-6 pb-2 pt-5">
          <div>
            {title && (
              <h3 className="text-base font-semibold text-[#14301f]">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-sm text-[#6b7a70]">{subtitle}</p>
            )}
          </div>
          {action && <div className="ml-4 flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={noPadding ? '' : 'p-6'}>{children}</div>
    </div>
  );
}
