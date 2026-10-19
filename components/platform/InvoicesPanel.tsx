'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';

interface InvoiceRow { id: string; number: string; issuedOn: string; dueOn: string; paidOn: string; amount: string; currency: string; description: string; status: string }

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: 'Unpaid', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  VOID: { label: 'Cancelled', variant: 'neutral' },
};

export function InvoicesPanel({ schoolId, invoices }: { schoolId: string; invoices: InvoiceRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ amount: '', currency: 'USD', description: '', dueOn: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    setErrors({});
    try {
      const res = await fetch(`/api/platform/schools/${schoolId}/invoices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const body = await res.json();
      if (!res.ok) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries((body.errors ?? {}) as Record<string, string[]>)) flat[k] = v[0];
        setErrors(flat);
        toast.error(body.errors ? 'Please check the form' : body.message ?? 'Could not create the invoice');
        return;
      }
      toast.success(`Invoice ${body.data.invoice.number} created`);
      setForm({ amount: '', currency: 'USD', description: '', dueOn: '' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function pay(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/platform/invoices/${id}/pay`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { toast.error(body.message ?? 'Could not mark it paid'); return; }
      toast.success('Marked as paid');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Invoices" subtitle="What Pfuma bills this school. The school sees these on its Subscription page.">
      <div className="flex flex-col gap-5">
        <form onSubmit={create} noValidate aria-label="New invoice" className="grid gap-3 sm:grid-cols-2">
          <Input id="i-amount" label="Amount" type="number" step="0.01" min="0" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={errors.amount} />
          <Select id="i-currency" label="Currency" options={[{ value: 'USD', label: 'USD' }, { value: 'ZIG', label: 'ZiG' }]} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          <div className="sm:col-span-2"><Input id="i-desc" label="What it is for" required placeholder="Standard plan, Term 1 2027" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} /></div>
          <Input id="i-due" label="Due date" type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} error={errors.dueOn} />
          <div className="flex items-end"><Button type="submit" loading={busy === 'create'}>Create invoice</Button></div>
        </form>

        {invoices.length === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Invoices">
            <table className="w-full min-w-[560px] text-left text-sm text-ink">
              <thead className="border-b border-line text-xs text-subtle">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Number</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Issued</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2.5 pr-3"><span className="font-mono text-xs">{i.number}</span><span className="block text-xs text-muted">{i.description}</span></td>
                    <td className="whitespace-nowrap py-2.5 pr-3">{i.issuedOn}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{i.currency} {i.amount}</td>
                    <td className="py-2.5 pr-3"><Badge variant={STATUS[i.status].variant} label={STATUS[i.status].label} />{i.paidOn ? <span className="block text-xs text-muted">{i.paidOn}</span> : null}</td>
                    <td className="py-2.5 text-right">
                      {i.status === 'OPEN' && <Button size="sm" variant="secondary" loading={busy === i.id} onClick={() => pay(i.id)}>Mark paid</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
