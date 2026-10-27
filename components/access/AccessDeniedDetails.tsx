'use client';
// The part of the access-denied page that needs the browser: the person's roles and the request form.
import { usePathname } from 'next/navigation';
import { PERMISSIONS } from '@/lib/access-core';
import { requiredKeysFor } from '@/lib/access/routes';
import { useRoles } from './AccessProvider';
import { RequestAccessButton } from './RequestAccessButton';

export function AccessDeniedDetails({ permission }: { permission?: string }) {
  const roles = useRoles();
  const pathname = usePathname() ?? '';
  const key = permission ?? requiredKeysFor(pathname)?.[0];
  const needs = key ? PERMISSIONS[key as keyof typeof PERMISSIONS] : undefined;
  return (
    <div className="flex w-full flex-col items-center gap-3">
      {needs && <p className="text-sm text-muted">This page needs the permission to <strong className="text-ink">{needs.charAt(0).toLowerCase() + needs.slice(1)}</strong>, which your roles do not include.</p>}
      {roles.length > 0 && <p className="text-sm text-muted">Your {roles.length === 1 ? 'role is' : 'roles are'}: <strong className="text-ink">{roles.join(', ')}</strong>.</p>}
      <RequestAccessButton permission={key} />
    </div>
  );
}
