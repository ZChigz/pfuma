'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
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

    if (result?.error) {
      setAuthError('Invalid email or password. Please try again.');
      return;
    }

    router.push('/');
    router.refresh();
  };

  return (
    <>
      <h1 className="mb-1 text-3xl font-bold tracking-tight text-[#14301f]">Sign in</h1>
      <p className="mb-8 text-sm text-[#6b7a70]">Enter your credentials to access your account.</p>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        aria-label="Sign in form"
        className="space-y-5"
      >
        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-[#14301f]">
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
            className="min-h-[48px] rounded-xl border border-[#e3e9e4] bg-[#f4f6f4] px-4 text-sm text-[#14301f] placeholder:text-[#8a968e] focus:outline-none focus:border-[#14613f] focus:bg-white focus:ring-2 focus:ring-[#14613f]/30 aria-[invalid=true]:border-red-500"
          />
          {errors.email && (
            <p id="email-error" role="alert" className="text-xs text-red-600">
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-[#14301f]">
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
            className="min-h-[48px] rounded-xl border border-[#e3e9e4] bg-[#f4f6f4] px-4 text-sm text-[#14301f] placeholder:text-[#8a968e] focus:outline-none focus:border-[#14613f] focus:bg-white focus:ring-2 focus:ring-[#14613f]/30 aria-[invalid=true]:border-red-500"
          />
          {errors.password && (
            <p id="password-error" role="alert" className="text-xs text-red-600">
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Auth-level error */}
        {authError && (
          <div role="alert" aria-live="assertive" className="rounded-xl bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{authError}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 flex min-h-[48px] w-full items-center justify-center rounded-full bg-[#14613f] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0f4d32] focus:outline-none focus:ring-2 focus:ring-[#14613f] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
