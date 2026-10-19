'use client';

// The week as a grid: days across, periods down. Used by the timetable builder (click or drag to place, amber and green
// hints for suggestions), the class and teacher views, and the printed pages. It only draws; the page decides what clicks do.
import { cn } from '@/lib/utils';
import { Dot } from '@/components/academics/shared';

export interface GridSlot {
  slotId: string; assignmentId: string; periodId: string; subject: string; shortName: string; colour: string; teacher: string; initials: string;
  target: string; room: string | null; roomId: string | null; isDouble: boolean; pairId: string | null; isGroup: boolean;
}
export interface GridPeriod { id: string; periodNo: number; start: string; end: string; type: string; label: string | null }
export interface GridDayData { dayOfWeek: number; name: string; periods: GridPeriod[] }
export type Hint = 'free' | 'busy' | 'warn';
export type DragPayload = { kind: 'slot'; slotId: string; assignmentId: string } | { kind: 'assignment'; assignmentId: string };

interface Props {
  days: GridDayData[];
  cells: Record<string, GridSlot[]>;
  view: 'class' | 'teacher' | 'room' | 'master';
  onCell?: (periodId: string) => void;
  onSlot?: (slot: GridSlot) => void;
  onDropOn?: (periodId: string, payload: DragPayload) => void;
  hints?: Record<string, { hint: Hint; text: string }>;
  unavailable?: string[];
  selectedSlotId?: string | null;
  dense?: boolean;
}

function label(s: GridSlot, view: Props['view']) {
  if (view === 'class') return [s.initials, s.room].filter(Boolean).join(' · ');
  if (view === 'teacher') return [s.target, s.room].filter(Boolean).join(' · ');
  if (view === 'room') return [s.target, s.initials].filter(Boolean).join(' · ');
  return [s.target, s.initials].join(' · ');
}

const HINT_CLASS: Record<Hint, string> = {
  free: 'bg-success-bg ring-2 ring-success/40', busy: 'bg-canvas opacity-60', warn: 'bg-warn-bg ring-2 ring-warn-line',
};

export function WeekGrid({ days, cells, view, onCell, onSlot, onDropOn, hints, unavailable = [], selectedSlotId, dense }: Props) {
  const rows = Array.from(new Set(days.flatMap((d) => d.periods.map((p) => p.periodNo)))).sort((a, b) => a - b);
  const find = (d: GridDayData, no: number) => d.periods.find((p) => p.periodNo === no);
  const reference = (no: number) => days.map((d) => find(d, no)).find(Boolean);
  const editable = !!(onCell || onDropOn);

  if (days.length === 0) return <p className="rounded-xl bg-white p-6 text-center text-sm text-muted">The bell schedule has no periods yet.</p>;

  return (
    <div className="overflow-x-auto rounded-2xl bg-white">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
        <caption className="sr-only">Weekly timetable</caption>
        <thead>
          <tr>
            <th scope="col" className="w-20 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Period</th>
            {days.map((d) => <th key={d.dayOfWeek} scope="col" className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">{d.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((no) => {
            const ref = reference(no);
            return (
              <tr key={no} className="border-t border-line align-top">
                <th scope="row" className="px-2 py-2 text-left text-xs font-semibold text-ink">
                  {ref?.type === 'LESSON' ? no : ref?.label ?? ref?.type}
                  <span className="block font-normal text-muted">{ref?.start}–{ref?.end}</span>
                </th>
                {days.map((d) => {
                  const p = find(d, no);
                  if (!p) return <td key={d.dayOfWeek} className="bg-canvas/50 px-2 py-2 text-center text-muted">—</td>;
                  if (p.type !== 'LESSON') {
                    return <td key={d.dayOfWeek} className="bg-canvas px-2 py-2 text-xs text-muted">{p.label ?? p.type.toLowerCase()}<span className="block">{p.start}–{p.end}</span></td>;
                  }
                  const slots = cells[p.id] ?? [];
                  const hint = hints?.[p.id];
                  const off = unavailable.includes(p.id);
                  return (
                    <td
                      key={d.dayOfWeek}
                      onDragOver={editable ? (e) => e.preventDefault() : undefined}
                      onDrop={onDropOn ? (e) => { e.preventDefault(); try { onDropOn(p.id, JSON.parse(e.dataTransfer.getData('application/json'))); } catch { /* not ours */ } } : undefined}
                      onClick={onCell && slots.length === 0 ? () => onCell(p.id) : undefined}
                      title={hint?.text}
                      className={cn(
                        'px-1.5 py-1.5 transition-colors', dense ? 'h-14' : 'h-20', hint && HINT_CLASS[hint.hint], off && 'bg-[repeating-linear-gradient(45deg,#f4f6f4,#f4f6f4_6px,#e3e9e4_6px,#e3e9e4_12px)]',
                        onCell && slots.length === 0 && 'cursor-pointer hover:bg-tint',
                      )}
                    >
                      {slots.length === 0 && hint?.hint === 'free' && <span className="text-xs font-semibold text-success">Fits here</span>}
                      <div className="flex flex-col gap-1">
                        {slots.map((s) => (
                          <button
                            key={s.slotId}
                            type="button"
                            draggable={!!onDropOn}
                            onDragStart={onDropOn ? (e) => e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'slot', slotId: s.slotId, assignmentId: s.assignmentId })) : undefined}
                            onClick={onSlot ? (e) => { e.stopPropagation(); onSlot(s); } : undefined}
                            disabled={!onSlot}
                            className={cn(
                              'flex w-full flex-col rounded-lg border-l-4 bg-white px-2 py-1 text-left shadow-sm ring-1 ring-line',
                              selectedSlotId === s.slotId && 'ring-2 ring-primary', onSlot && 'hover:ring-primary/50',
                            )}
                            style={{ borderLeftColor: s.colour }}
                          >
                            <span className="flex items-center gap-1 font-semibold text-ink"><Dot colour={s.colour} />{s.shortName}{s.isDouble && <span className="rounded bg-tint px-1 text-[10px] font-bold text-primary">DOUBLE</span>}{s.isGroup && <span className="rounded bg-canvas px-1 text-[10px] text-muted">GROUP</span>}</span>
                            <span className="truncate text-xs text-muted">{label(s, view)}</span>
                          </button>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
