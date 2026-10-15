'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [authError, setAuthError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (values: FormValues) => {
    setAuthError(null);

    const result = await signIn('credentials', {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (result?.code === 'account_locked') {
      setAuthError('Too many failed attempts. Please wait 15 minutes before trying again.');
      return;
    }
    if (result?.error) {
      setAuthError('Invalid email or password. Please try again.');
      return;
    }

    router.push('/');
    router.refresh();
  };

  return (
    <>
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-ink">Sign in</h1>
      <p className="mb-8 text-sm text-muted">Enter your credentials to access your account.</p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        aria-label="Sign in form"
        className="space-y-5"
      >
        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-ink">
            Email
          </label>
          <input
            {...register('email')}
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@school.ac.zw"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            className="min-h-[48px] rounded-xl border border-line bg-canvas px-4 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-danger"
          />
          {errors.email && (
            <p id="email-error" role="alert" className="text-xs text-danger">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-ink">
            Password
          </label>
          <input
            {...register('password')}
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            className="min-h-[48px] rounded-xl border border-line bg-canvas px-4 text-sm text-ink placeholder:text-subtle focus:outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/30 aria-[invalid=true]:border-danger"
          />
          {errors.password && (
            <p id="password-error" role="alert" className="text-xs text-danger">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Auth-level error */}
        {authError && (
          <div role="alert" aria-live="assertive" className="rounded-xl bg-danger-bg px-4 py-3">
            <p className="text-sm text-danger">{authError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <svg
                className="mr-2 h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>
    </>
  );
}
