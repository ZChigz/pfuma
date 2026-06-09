import { cn } from '@/lib/utils';
import { type InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

function AlertIcon() {
  return (
    <svg className="mr-1 h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, required, disabled, ...props }, ref) => (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-[#292524]">
          {label}
          {required && <span className="ml-0.5 text-[#b91c1c]" aria-hidden="true">*</span>}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        required={required}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(
          'min-h-[44px] rounded-md border border-[#e7e5e4] bg-white px-3 py-2 text-sm text-[#292524]',
          'placeholder:text-[#78716c] focus:outline-none focus:ring-2 focus:ring-[#065f46]/30',
          'disabled:cursor-not-allowed disabled:bg-stone-50 disabled:opacity-60',
          error && 'border-[#b91c1c] focus:ring-[#b91c1c]/30',
          className,
        )}
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-[#78716c]">{hint}</p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center text-xs text-[#b91c1c]">
          <AlertIcon />
          {error}
        </p>
      )}
    </div>
  ),
);

Input.displayName = 'Input';
