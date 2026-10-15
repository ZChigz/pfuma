'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { formatDate, formatDateTime } from '@/lib/utils';

interface View {
  id: string;
  ip: string;
  createdAt: string;
}

interface Props {
  studentId: string;
  hasLink: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  hasPin: boolean;
  views: View[];
}

interface PinResult {
  pin: string;
  guardianPhone: string | null;
  whatsappUrl: string | null;
  smsUrl: string | null;
}

// The link itself is never stored, so it can only be shown right after it is
// generated. "Regenerate link" replaces the old link at once.
export function PortalLinkPanel({ studentId, hasLink, createdAt, expiresAt, hasPin, views }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [pin, setPin] = useState<PinResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function call(url: string, method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      const res = await fetch(url, { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.message ?? 'Action failed');
        return null;
      }
      return data.data;
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (hasLink && !confirm('Regenerate the link? The old link stops working immediately.')) return;
    const data = await call(`/api/portal-links/${studentId}`, 'POST');
    if (!data) return;
    setNewUrl(data.portalUrl);
    toast.success('New portal link created — copy it now, it is shown only once');
    router.refresh();
  }

  async function makePin() {
    if (hasPin && !confirm('Create a new PIN? Parents will be asked for it again on every device.')) return;
    const data = await call(`/api/portal-links/${studentId}/pin`, 'POST');
    if (!data) return;
    setPin(data);
    router.refresh();
  }

  async function removePin() {
    if (!confirm('Remove the PIN? The link will open without one.')) return;
    if (await call(`/api/portal-links/${studentId}/pin`, 'DELETE')) {
      setPin(null);
      toast.success('PIN removed');
      router.refresh();
    }
  }

  async function copy() {
    if (!newUrl) return;
    await navigator.clipboard.writeText(newUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-xs font-medium text-muted">Parent portal</p>
        <span className="flex-1 text-sm text-ink">
          {hasLink
            ? `Link active${expiresAt ? ` until ${formatDate(expiresAt)}` : ''}${createdAt ? ` · created ${formatDate(createdAt)}` : ''}`
            : 'No link yet'}
          {hasLink && (hasPin ? ' · PIN on' : ' · no PIN')}
        </span>
        <Button variant="ghost" size="sm" onClick={regenerate} loading={busy}>
          {hasLink ? 'Regenerate link' : 'Create link'}
        </Button>
        {hasLink && (
          <Button variant="ghost" size="sm" onClick={makePin} loading={busy}>
            {hasPin ? 'New PIN' : 'Add PIN'}
          </Button>
        )}
        {hasPin && (
          <Button variant="ghost" size="sm" onClick={removePin} loading={busy}>
            Remove PIN
          </Button>
        )}
      </div>

      {newUrl && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-success-bg px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{newUrl}</span>
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy link'}
          </Button>
        </div>
      )}

      {pin && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-success-bg px-3 py-2 text-sm text-ink">
          <span>
            PIN <strong className="tracking-widest">{pin.pin}</strong> — shown once.
          </span>
          {pin.whatsappUrl && (
            <a className="text-primary underline underline-offset-2" href={pin.whatsappUrl} target="_blank" rel="noopener noreferrer">
              Send by WhatsApp to {pin.guardianPhone}
            </a>
          )}
          {pin.smsUrl && (
            <a className="text-primary underline underline-offset-2" href={pin.smsUrl}>
              Send by SMS
            </a>
          )}
          {!pin.guardianPhone && <span className="text-muted">No primary guardian phone on file.</span>}
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-muted">Recent portal views</p>
        {views.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Not opened yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line text-sm">
            {views.map((v) => (
              <li key={v.id} className="flex justify-between gap-3 py-1">
                <span className="text-ink">{formatDateTime(v.createdAt)}</span>
                <span className="text-muted">{v.ip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
