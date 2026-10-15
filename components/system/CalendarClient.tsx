'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { CalendarEventSchema } from '@/lib/validations/system';
import type { CalendarItem } from '@/lib/system/calendar';

type FormInput = z.input<typeof CalendarEventSchema>;
type FormOutput = z.output<typeof CalendarEventSchema>;

const KINDS = [
  { value: 'HOLIDAY', label: 'Holiday' },
  { value: 'EXAM', label: 'Exam' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'OTHER', label: 'Other' },
];
const KIND_VARIANT: Record<string, BadgeVariant> = { TERM: 'success', HOLIDAY: 'warning', EXAM: 'danger', SPORTS: 'info', MEETING: 'neutral', OTHER: 'neutral' };
const KIND_LABEL: Record<string, string> = { TERM: 'Term', ...Object.fromEntries(KINDS.map((k) => [k.value, k.label])) };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface Props {
  year: number;
  items: CalendarItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export function CalendarClient({ year, items, canCreate, canUpdate, canDelete }: Props) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<{ id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<CalendarItem | null>(null);
  const [busy, setBusy] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(CalendarEventSchema),
  });

  function open(item?: CalendarItem) {
    reset(item
      ? { title: item.title, kind: item.kind as FormInput['kind'], startDate: item.startDate, endDate: item.endDate, notes: item.notes ?? '' }
      : { title: '', kind: 'OTHER', startDate: '', endDate: '', notes: '' });
    setDrawer({ id: item?.id ?? null });
  }

  async function save(values: FormOutput) {
    const id = drawer?.id;
    const res = await fetch(id ? `/api/system/calendar/${id}` : '/api/system/calendar', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save the event');
      return;
    }
    toast.success(id ? 'Event updated' : 'Event added');
    setDrawer(null);
    router.refresh();
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/system/calendar/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error((await res.json()).message ?? 'Could not delete the event');
        return;
      }
      toast.success('Event deleted');
      setDeleting(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Group by the month an item starts in (items that began last year go under January).
  const byMonth = new Map<number, CalendarItem[]>();
  for (const it of items) {
    const m = it.startDate.startsWith(String(year)) ? Number(it.startDate.slice(5, 7)) - 1 : 0;
    byMonth.set(m, [...(byMonth.get(m) ?? []), it]);
  }

  const range = (it: CalendarItem) => (it.startDate === it.endDate ? formatDate(it.startDate) : `${formatDate(it.startDate)} to ${formatDate(it.endDate)}`);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={`/system/calendar?year=${year - 1}`} className="flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-tint">{year - 1}</Link>
          <span className="px-2 text-lg font-semibold text-ink">{year}</span>
          <Link href={`/system/calendar?year=${year + 1}`} className="flex min-h-[44px] items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink hover:bg-tint">{year + 1}</Link>
        </div>
        {canCreate && <Button onClick={() => open()}>Add event</Button>}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={`Nothing on the ${year} calendar`}
          description="Add holidays, exams, sports days and meetings. Term dates appear here once the academic calendar is set up."
          action={canCreate ? <Button onClick={() => open()}>Add event</Button> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {Array.from(byMonth.keys()).sort((a, b) => a - b).map((m) => (
            <section key={m} aria-label={MONTHS[m]}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{MONTHS[m]}</h2>
              <ul className="flex flex-col gap-2">
                {byMonth.get(m)!.map((it) => (
                  <li key={`${it.source}-${it.id}`} className="flex flex-col gap-2 rounded-2xl bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{it.title}</p>
                        <Badge variant={KIND_VARIANT[it.kind]} label={KIND_LABEL[it.kind] ?? it.kind} />
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{range(it)}</p>
                      {it.notes && <p className="mt-1 break-words text-sm text-muted">{it.notes}</p>}
                    </div>
                    {it.source === 'event' && (canUpdate || canDelete) && (
                      <div className="flex items-center">
                        {canUpdate && <button type="button" onClick={() => open(it)} className="min-h-[44px] rounded-lg px-3 text-xs font-semibold text-primary hover:bg-tint">Edit</button>}
                        {canDelete && <button type="button" onClick={() => setDeleting(it)} className="min-h-[44px] rounded-lg px-3 text-xs font-semibold text-danger hover:bg-danger-bg">Delete</button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">Term dates come from the academic calendar and are changed there.</p>

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={drawer?.id ? 'Edit event' : 'Add event'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawer(null)} disabled={isSubmitting}>Cancel</Button>
            <Button form="event-form" type="submit" loading={isSubmitting}>{drawer?.id ? 'Save changes' : 'Add event'}</Button>
          </>
        }
      >
        <form id="event-form" onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
          <Input id="e-title" label="Title" required error={errors.title?.message} {...register('title')} />
          <Select id="e-kind" label="Type" required options={KINDS} error={errors.kind?.message} {...register('kind')} />
          <Input id="e-start" label="Starts" type="date" required error={errors.startDate?.message} {...register('startDate')} />
          <Input id="e-end" label="Ends" type="date" required hint="Same as the start date for a one-day event" error={errors.endDate?.message} {...register('endDate')} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="e-notes" className="text-sm font-medium text-ink">Notes</label>
            <textarea id="e-notes" rows={3} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" {...register('notes')} />
            {errors.notes?.message && <p role="alert" className="text-xs text-danger">{errors.notes.message}</p>}
          </div>
        </form>
      </Drawer>

      <ConfirmDialog open={deleting !== null} title="Delete event?" confirmLabel="Delete" destructive loading={busy} onCancel={() => setDeleting(null)} onConfirm={remove}>
        &ldquo;{deleting?.title}&rdquo; will be removed from the calendar. The audit log keeps a record that you deleted it.
      </ConfirmDialog>
    </>
  );
}
