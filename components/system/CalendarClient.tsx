'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { CalendarEventSchema, EVENT_KINDS } from '@/lib/validations/system';
import { AUDIENCE_LABEL, KIND_INFO, KIND_ORDER, REPEAT_LABEL, monthName, rangeText, timeText, type CalendarKindKey } from '@/lib/system/calendar-types';
import { shiftDate, weekDays, type CalendarView } from '@/lib/system/calendar-grid';
import type { CalendarItem } from '@/lib/system/calendar';
import { ListView, MonthView, WeekView } from './CalendarViews';

type FormInput = z.input<typeof CalendarEventSchema>;
type FormOutput = z.output<typeof CalendarEventSchema>;

export interface CalendarProps {
  view: CalendarView;
  date: string;
  today: string;
  type: string;
  items: CalendarItem[];
  levels: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  /** Term the PDF is for; null when no term exists. */
  pdfTermId: string | null;
  // All from can() on the server.
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canExport: boolean;
}

type Panel = { mode: 'add'; day: string } | { mode: 'edit'; item: CalendarItem } | { mode: 'view'; item: CalendarItem } | null;

const KIND_OPTIONS = EVENT_KINDS.map((k) => ({ value: k, label: KIND_INFO[k].label }));
const AUDIENCE_OPTIONS = Object.entries(AUDIENCE_LABEL).map(([value, label]) => ({ value, label }));
const REPEAT_OPTIONS = Object.entries(REPEAT_LABEL).map(([value, label]) => ({ value, label }));

const blank = (day: string): FormInput => ({
  title: '', kind: 'OTHER', startDate: day, endDate: day, allDay: true, startTime: '', endTime: '', audience: 'ALL_STAFF',
  audienceLevelIds: [], audienceClassIds: [], location: '', notes: '', repeat: 'NONE', repeatUntil: '',
});

export function CalendarClient(p: CalendarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CalendarItem | null>(null);
  const [warnings, setWarnings] = useState<{ values: FormOutput; messages: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(CalendarEventSchema),
    defaultValues: blank(p.today),
  });
  const allDay = watch('allDay');
  const audience = watch('audience');
  const repeat = watch('repeat');
  const levelIds = watch('audienceLevelIds') ?? [];
  const classIds = watch('audienceClassIds') ?? [];

  function openAdd(day: string) {
    reset(blank(day));
    setPanel({ mode: 'add', day });
  }
  function openItem(item: CalendarItem) {
    if (item.source === 'term' || !p.canUpdate) { setPanel({ mode: 'view', item }); return; }
    reset({
      title: item.title, kind: item.kind as FormInput['kind'], startDate: item.seriesStart, endDate: item.seriesEnd, allDay: item.allDay,
      startTime: item.startTime ?? '', endTime: item.endTime ?? '', audience: item.audience, audienceLevelIds: item.audienceLevelIds,
      audienceClassIds: item.audienceClassIds, location: item.location ?? '', notes: item.notes ?? '', repeat: item.repeat, repeatUntil: item.repeatUntil ?? '',
    });
    setPanel({ mode: 'edit', item });
  }

  // On a phone, a tap on a day shows that day's events; on a wider screen it starts a new event.
  function onDay(day: string) {
    const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
    if (p.canCreate && wide) openAdd(day);
    else setSelectedDay(day);
  }

  // The dashboard's "Add event" quick action links here with ?new=1.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (wantsNew && p.canCreate) openAdd(p.today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phones open the list view unless a view was asked for.
  useEffect(() => {
    if (!params.get('view') && window.matchMedia('(max-width: 639px)').matches) {
      const next = new URLSearchParams(params.toString());
      next.set('view', 'list');
      router.replace(`/system/calendar?${next.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.delete('new');
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/system/calendar?${next.toString()}`;
  };

  async function send(values: FormOutput, acknowledged: boolean) {
    const editing = panel?.mode === 'edit' ? panel.item : null;
    const res = await fetch(editing ? `/api/system/calendar/${editing.id}` : '/api/system/calendar', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, acknowledged }),
    });
    const body = await res.json();
    if (res.status === 409 && body.needsConfirmation) {
      setWarnings({ values, messages: body.warnings });
      return;
    }
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save the event');
      return;
    }
    toast.success(editing ? 'Event updated' : 'Event added');
    setWarnings(null);
    setPanel(null);
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
      setPanel(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const heading =
    p.view === 'week'
      ? `${rangeText(weekDays(p.date)[0], weekDays(p.date)[0]).replace(/ \d{4}$/, '')} to ${rangeText(weekDays(p.date)[6], weekDays(p.date)[6])}`
      : `${monthName(Number(p.date.slice(5, 7)) - 1)} ${p.date.slice(0, 4)}`;
  const dayItems = selectedDay ? p.items.filter((i) => i.startDate <= selectedDay && i.endDate >= selectedDay) : [];
  const editing = panel?.mode === 'edit' ? panel.item : null;
  const toggle = (name: 'audienceLevelIds' | 'audienceClassIds', id: string, current: string[]) =>
    setValue(name, current.includes(id) ? current.filter((x) => x !== id) : [...current, id], { shouldValidate: true });

  const tab = (v: CalendarView, label: string) => (
    <Link
      key={v}
      href={link({ view: v })}
      aria-current={p.view === v ? 'page' : undefined}
      className={cn('flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium', p.view === v ? 'bg-primary text-white' : 'bg-white text-ink hover:bg-tint')}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Calendar view" className="flex gap-1">{tab('month', 'Month')}{tab('week', 'Week')}{tab('list', 'List')}</nav>
        <div className="flex items-center gap-1">
          <Link href={link({ date: shiftDate(p.view, p.date, -1) })} aria-label="Previous" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink hover:bg-tint">‹</Link>
          <Link href={link({ date: p.today })} className="flex min-h-[44px] items-center rounded-full bg-white px-4 text-sm font-medium text-ink hover:bg-tint">Today</Link>
          <Link href={link({ date: shiftDate(p.view, p.date, 1) })} aria-label="Next" className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink hover:bg-tint">›</Link>
        </div>
        <h2 className="min-w-0 flex-1 text-base font-semibold text-ink">{heading}</h2>
        <label className="flex items-center">
          <span className="sr-only">Event type</span>
          <select
            value={p.type}
            onChange={(e) => router.push(link({ type: e.target.value || null }))}
            className="min-h-[44px] rounded-xl border border-line bg-white px-3 text-sm text-ink"
          >
            <option value="">All types</option>
            {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_INFO[k].label}</option>)}
          </select>
        </label>
        {p.canExport && p.pdfTermId && (
          <a href={`/api/system/calendar/pdf?termId=${p.pdfTermId}`} download className="inline-flex min-h-[44px] items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary hover:bg-tint">
            Export term PDF
          </a>
        )}
        {p.canCreate && <Button onClick={() => openAdd(p.today)}>Add event</Button>}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Event types">
        {KIND_ORDER.map((k) => (
          <li key={k} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIND_INFO[k].color }} aria-hidden="true" />
            {KIND_INFO[k].label}
          </li>
        ))}
      </ul>

      {p.items.length === 0 && p.view === 'list' ? (
        <EmptyState
          title={p.type ? 'No events of this type' : 'Nothing on the calendar this month'}
          description="Add holidays, exams, sports days and meetings. Term dates and public holidays appear on their own."
          action={p.canCreate ? <Button onClick={() => openAdd(p.today)}>Add event</Button> : undefined}
        />
      ) : p.view === 'month' ? (
        <MonthView {...p} selectedDay={selectedDay} onDay={onDay} onItem={openItem} />
      ) : p.view === 'week' ? (
        <WeekView {...p} selectedDay={selectedDay} onDay={(d) => (p.canCreate ? openAdd(d) : setSelectedDay(d))} onItem={openItem} />
      ) : (
        <ListView items={p.items} onItem={openItem} />
      )}

      {selectedDay && p.view === 'month' && (
        <section aria-label={`Events on ${rangeText(selectedDay, selectedDay)}`} className="rounded-2xl bg-white p-4 sm:hidden">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{rangeText(selectedDay, selectedDay)}</h2>
            {p.canCreate && <button type="button" onClick={() => openAdd(selectedDay)} className="min-h-[44px] px-2 text-sm font-semibold text-primary">Add event</button>}
          </div>
          {dayItems.length === 0 ? <p className="mt-1 text-sm text-muted">Nothing on this day.</p> : (
            <ul className="mt-2 flex flex-col gap-2">
              {dayItems.map((i) => (
                <li key={i.key}>
                  <button type="button" onClick={() => openItem(i)} className="flex min-h-[44px] w-full items-center gap-2 text-left text-sm text-ink">
                    <span className="h-3 w-1.5 rounded-full" style={{ background: KIND_INFO[i.kind].color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <span className="text-xs text-muted">{KIND_INFO[i.kind].label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-xs text-muted">
        Term dates come from Academic Terms and cannot be changed here.{' '}
        <Link href="/admin/academic" className="font-medium text-primary hover:underline">Open Academic Terms</Link>
      </p>

      {/* Add / edit */}
      <Drawer
        open={panel?.mode === 'add' || panel?.mode === 'edit'}
        onClose={() => setPanel(null)}
        title={editing ? 'Edit event' : 'Add event'}
        footer={
          <>
            {editing && p.canDelete && <Button variant="danger" className="mr-auto" onClick={() => setDeleting(editing)} disabled={isSubmitting}>Delete</Button>}
            <Button variant="secondary" onClick={() => setPanel(null)} disabled={isSubmitting}>Cancel</Button>
            <Button form="event-form" type="submit" loading={isSubmitting}>{editing ? 'Save changes' : 'Add event'}</Button>
          </>
        }
      >
        <form id="event-form" onSubmit={handleSubmit((v) => send(v, false))} className="flex flex-col gap-4" noValidate>
          <Input id="e-title" label="Title" required maxLength={120} error={errors.title?.message} {...register('title')} />
          <Select id="e-kind" label="Type" required options={KIND_OPTIONS} error={errors.kind?.message} {...register('kind')} />
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
            <input type="checkbox" className="h-5 w-5 accent-primary" {...register('allDay')} /> All day
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input id="e-start" label="Starts" type="date" required error={errors.startDate?.message} {...register('startDate')} />
            {!allDay && <Input id="e-stime" label="Start time" type="time" required error={errors.startTime?.message} {...register('startTime')} />}
            <Input id="e-end" label="Ends" type="date" required error={errors.endDate?.message} {...register('endDate')} />
            {!allDay && <Input id="e-etime" label="End time" type="time" required error={errors.endTime?.message} {...register('endTime')} />}
          </div>

          <Select id="e-aud" label="Audience" options={AUDIENCE_OPTIONS} {...register('audience')} />
          {audience === 'FORMS' && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium text-ink">Forms</legend>
              {p.levels.map((l) => (
                <label key={l.id} className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
                  <input type="checkbox" className="h-5 w-5 accent-primary" checked={levelIds.includes(l.id)} onChange={() => toggle('audienceLevelIds', l.id, levelIds)} /> {l.name}
                </label>
              ))}
              {errors.audienceLevelIds?.message && <p role="alert" className="text-xs text-danger">{errors.audienceLevelIds.message}</p>}
            </fieldset>
          )}
          {audience === 'CLASSES' && (
            <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              <legend className="mb-1 text-sm font-medium text-ink">Classes</legend>
              {p.classes.map((c) => (
                <label key={c.id} className="flex min-h-[44px] items-center gap-3 text-sm text-ink">
                  <input type="checkbox" className="h-5 w-5 accent-primary" checked={classIds.includes(c.id)} onChange={() => toggle('audienceClassIds', c.id, classIds)} /> {c.name}
                </label>
              ))}
              {errors.audienceClassIds?.message && <p role="alert" className="text-xs text-danger">{errors.audienceClassIds.message}</p>}
            </fieldset>
          )}

          <Input id="e-loc" label="Location" maxLength={120} error={errors.location?.message} {...register('location')} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="e-notes" className="text-sm font-medium text-ink">Description</label>
            <textarea id="e-notes" rows={3} maxLength={1000} className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" {...register('notes')} />
            {errors.notes?.message && <p role="alert" className="text-xs text-danger">{errors.notes.message}</p>}
          </div>

          <Select id="e-rep" label="Repeats" options={REPEAT_OPTIONS} {...register('repeat')} />
          {repeat !== 'NONE' && (
            <>
              <Input id="e-until" label="Repeats until" type="date" required error={errors.repeatUntil?.message} {...register('repeatUntil')} />
              {editing && <p className="text-xs text-muted">Changes and deletion apply to every date in the series.</p>}
            </>
          )}
        </form>
      </Drawer>

      {/* Read-only: term dates, or no permission to edit */}
      <Drawer open={panel?.mode === 'view'} onClose={() => setPanel(null)} title={panel?.mode === 'view' ? panel.item.title : ''}>
        {panel?.mode === 'view' && (
          <dl className="flex flex-col gap-3 text-sm">
            <div><dt className="text-xs text-subtle">Type</dt><dd className="text-ink">{KIND_INFO[panel.item.kind as CalendarKindKey].label}</dd></div>
            <div><dt className="text-xs text-subtle">When</dt><dd className="text-ink">{rangeText(panel.item.startDate, panel.item.endDate)} · {timeText(panel.item)}</dd></div>
            {panel.item.location && <div><dt className="text-xs text-subtle">Location</dt><dd className="text-ink">{panel.item.location}</dd></div>}
            {panel.item.notes && <div><dt className="text-xs text-subtle">Description</dt><dd className="whitespace-pre-wrap break-words text-ink">{panel.item.notes}</dd></div>}
            {panel.item.source === 'event' && (
              <>
                <div><dt className="text-xs text-subtle">Audience</dt><dd className="text-ink">{AUDIENCE_LABEL[panel.item.audience]}</dd></div>
                <div><dt className="text-xs text-subtle">Repeats</dt><dd className="text-ink">{REPEAT_LABEL[panel.item.repeat]}{panel.item.repeatUntil ? ` until ${rangeText(panel.item.repeatUntil, panel.item.repeatUntil)}` : ''}</dd></div>
              </>
            )}
            {panel.item.source === 'term' && (
              <p className="rounded-xl bg-canvas p-3 text-muted">
                Term dates come from Academic Terms and cannot be edited here.{' '}
                <Link href="/admin/academic" className="font-medium text-primary hover:underline">Open Academic Terms</Link>
              </p>
            )}
          </dl>
        )}
      </Drawer>

      <ConfirmDialog open={deleting !== null} title="Delete event?" confirmLabel="Delete" destructive loading={busy} onCancel={() => setDeleting(null)} onConfirm={remove}>
        &ldquo;{deleting?.title}&rdquo; will be removed from the calendar{deleting && deleting.repeat !== 'NONE' ? ', along with every date it repeats on' : ''}. The audit log keeps a record that you deleted it.
      </ConfirmDialog>

      <ConfirmDialog
        open={warnings !== null}
        title="Save anyway?"
        confirmLabel="Save anyway"
        loading={isSubmitting}
        onCancel={() => setWarnings(null)}
        onConfirm={() => warnings && send(warnings.values, true)}
      >
        <ul className="list-disc space-y-1 pl-5">{warnings?.messages.map((m) => <li key={m}>{m}</li>)}</ul>
      </ConfirmDialog>
    </>
  );
}
