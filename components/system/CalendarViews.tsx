'use client';

import { cn } from '@/lib/utils';
import { KIND_INFO, monthName, rangeText, timeText } from '@/lib/system/calendar-types';
import { monthGrid, onDay, weekDays, type CalendarView } from '@/lib/system/calendar-grid';
import type { CalendarItem } from '@/lib/system/calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ViewProps {
  view: CalendarView;
  date: string;
  items: CalendarItem[];
  today: string;
  selectedDay: string | null;
  onDay: (day: string) => void;
  onItem: (item: CalendarItem) => void;
}

function Chip({ item, onItem, compact }: { item: CalendarItem; onItem: (i: CalendarItem) => void; compact?: boolean }) {
  const info = KIND_INFO[item.kind];
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onItem(item); }}
      title={`${item.title} · ${info.label} · ${timeText(item)}`}
      aria-label={`${item.title}, ${info.label}, ${rangeText(item.startDate, item.endDate)}, ${timeText(item)}`}
      className={cn(
        'block w-full truncate rounded-md border-l-4 bg-canvas px-1.5 text-left text-[11px] leading-5 text-ink hover:bg-tint focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        compact && 'min-h-[20px]',
      )}
      style={{ borderLeftColor: info.color }}
    >
      {!item.allDay && item.startTime ? `${item.startTime} ` : ''}{item.title}
    </button>
  );
}

export function MonthView({ date, items, today, selectedDay, onDay: pick, onItem }: ViewProps) {
  const weeks = monthGrid(date);
  const month = date.slice(0, 7);
  return (
    <div role="grid" aria-label={`${monthName(Number(date.slice(5, 7)) - 1)} ${date.slice(0, 4)}`} className="overflow-hidden rounded-2xl bg-white">
      <div role="row" className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="px-1 py-2 text-center text-xs font-medium text-subtle">{d}</div>)}
      </div>
      {weeks.map((week) => (
        <div role="row" key={week[0]} className="grid grid-cols-7 border-b border-line last:border-0">
          {week.map((day) => {
            const here = items.filter((i) => onDay(i, day));
            const outside = !day.startsWith(month);
            return (
              <div
                key={day}
                role="gridcell"
                aria-selected={selectedDay === day}
                tabIndex={0}
                onClick={() => pick(day)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(day); } }}
                aria-label={`${rangeText(day, day)}, ${here.length} event${here.length === 1 ? '' : 's'}`}
                className={cn(
                  'min-h-[56px] cursor-pointer border-r border-line p-1 last:border-0 hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:min-h-[104px]',
                  outside && 'bg-canvas/60 text-subtle',
                  selectedDay === day && 'bg-tint',
                )}
              >
                <span className={cn('inline-flex h-6 min-w-[24px] items-center justify-center rounded-full text-xs', day === today ? 'bg-primary font-semibold text-white' : 'text-ink', outside && 'text-subtle')}>
                  {Number(day.slice(8))}
                </span>
                {/* Phone: coloured dots. Larger screens: titles. */}
                <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                  {here.slice(0, 4).map((i) => <span key={i.key} className="h-2 w-2 rounded-full" style={{ background: KIND_INFO[i.kind].color }} />)}
                </div>
                <div className="mt-1 hidden flex-col gap-0.5 sm:flex">
                  {here.slice(0, 3).map((i) => <Chip key={i.key} item={i} onItem={onItem} compact />)}
                  {here.length > 3 && <span className="px-1 text-[11px] text-muted">+{here.length - 3} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function WeekView({ date, items, today, onDay: pick, onItem }: ViewProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {weekDays(date).map((day, idx) => {
        const here = items.filter((i) => onDay(i, day));
        return (
          <section key={day} aria-label={rangeText(day, day)} className={cn('rounded-2xl bg-white p-3', day === today && 'ring-2 ring-primary/40')}>
            <button type="button" onClick={() => pick(day)} className="flex min-h-[44px] w-full items-center justify-between text-left text-sm font-semibold text-ink hover:text-primary">
              <span>{WEEKDAYS[idx]} {Number(day.slice(8))}</span>
              <span className="text-xs font-normal text-primary">Add</span>
            </button>
            <div className="mt-1 flex flex-col gap-1">
              {here.length === 0 && <p className="text-xs text-muted">Nothing</p>}
              {here.map((i) => <Chip key={i.key} item={i} onItem={onItem} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function ListView({ items, onItem }: Pick<ViewProps, 'items' | 'onItem'>) {
  const days = Array.from(new Set(items.map((i) => i.startDate))).sort();
  return (
    <div className="flex flex-col gap-4">
      {days.map((d) => (
        <section key={d} aria-label={rangeText(d, d)}>
          <h2 className="mb-1.5 text-sm font-semibold text-muted">{rangeText(d, d)}</h2>
          <ul className="flex flex-col gap-2">
            {items.filter((i) => i.startDate === d).map((i) => {
              const info = KIND_INFO[i.kind];
              return (
                <li key={i.key}>
                  <button
                    type="button"
                    onClick={() => onItem(i)}
                    className="flex min-h-[56px] w-full items-stretch gap-3 rounded-2xl bg-white p-3 text-left hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="w-1.5 flex-shrink-0 rounded-full" style={{ background: info.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-ink">{i.title}</span>
                      <span className="block text-xs text-muted">
                        {info.label} · {timeText(i)}{i.startDate !== i.endDate ? ` · until ${rangeText(i.endDate, i.endDate)}` : ''}{i.location ? ` · ${i.location}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
