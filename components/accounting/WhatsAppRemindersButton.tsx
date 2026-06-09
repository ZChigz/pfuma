'use client';

import { useState } from 'react';
import { buildWhatsAppLink, formatUSD, formatZiG } from '@/lib/utils';

export interface OwingStudent {
  id: string;
  fullName: string;
  parentPhone: string;
  balanceUSD: number;
  balanceZiG: number;
}

interface Props {
  owingStudents: OwingStudent[];
  currency: string;
}

export function WhatsAppRemindersButton({ owingStudents, currency }: Props) {
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (owingStudents.length === 0) return;

    for (const s of owingStudents) {
      const balance =
        currency === 'USD'
          ? formatUSD(s.balanceUSD)
          : formatZiG(s.balanceZiG);
      const message =
        `Dear parent of ${s.fullName}, this is a friendly reminder that your child has an outstanding fee balance of ${balance}. ` +
        `Please settle at your earliest convenience. Thank you.`;
      window.open(buildWhatsAppLink(s.parentPhone, message), '_blank', 'noopener');
    }

    setSent(true);
    setTimeout(() => setSent(false), 4000);
  };

  return (
    <button
      onClick={handleSend}
      disabled={owingStudents.length === 0}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1fb855] focus:outline-none focus:ring-2 focus:ring-[#25D366]/40 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {/* WhatsApp logo */}
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.123 1.531 5.855L.062 23.438l5.735-1.444C7.64 23.29 9.761 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.86 0-3.598-.492-5.1-1.352l-.365-.215-3.41.859.892-3.298-.238-.38A9.93 9.93 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
      </svg>
      {sent
        ? `Opened ${owingStudents.length} reminder${owingStudents.length !== 1 ? 's' : ''}`
        : `Send Reminders (${owingStudents.length})`}
    </button>
  );
}
