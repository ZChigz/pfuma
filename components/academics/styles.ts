// Class names server pages use directly. Kept out of shared.tsx (a 'use client' module): a server component that imports a constant
// from a client module gets a client reference instead of the string, and the production render fails.
export const linkButton = 'inline-flex min-h-[44px] items-center justify-center rounded-full border border-primary bg-white px-5 text-sm font-semibold text-primary hover:bg-tint';
export const primaryLink = 'inline-flex min-h-[44px] items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover';
