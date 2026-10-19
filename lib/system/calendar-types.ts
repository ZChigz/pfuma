// Names and colours of the calendar's event types, shared by the screen and the PDF.
// Colours are the validated categorical palette in fixed order; the type's name is always
// written next to its colour, so colour is never the only way to tell them apart.
export type CalendarKindKey = 'TERM' | 'PUBLIC_HOLIDAY' | 'EXAM' | 'MEETING' | 'SPORTS' | 'CULTURAL' | 'VISITING_DAY' | 'PRIZE_GIVING' | 'OTHER';

export const KIND_INFO: Record<CalendarKindKey, { label: string; color: string }> = {
  TERM:           { label: 'Term date',      color: '#008300' },
  PUBLIC_HOLIDAY: { label: 'Public holiday', color: '#e34948' },
  EXAM:           { label: 'Exam',           color: '#6250d6' },
  MEETING:        { label: 'Meeting',        color: '#2a78d6' },
  SPORTS:         { label: 'Sports',         color: '#1baf7a' },
  CULTURAL:       { label: 'Cultural',       color: '#e87ba4' },
  VISITING_DAY:   { label: 'Visiting day',   color: '#eb6834' },
  PRIZE_GIVING:   { label: 'Prize giving',   color: '#eda100' },
  OTHER:          { label: 'Other',          color: '#8a968e' },
};

export const KIND_ORDER = Object.keys(KIND_INFO) as CalendarKindKey[];

export const AUDIENCE_LABEL = { ALL_STAFF: 'All staff', FORMS: 'Specific forms', CLASSES: 'Specific classes', BOARDERS: 'Boarders' } as const;
export const REPEAT_LABEL = { NONE: 'Does not repeat', WEEKLY: 'Every week', MONTHLY: 'Every month', YEARLY: 'Every year' } as const;

/** "08:00 to 10:30", "from 08:00", or "All day". */
export function timeText(item: { allDay: boolean; startTime: string | null; endTime: string | null }): string {
  if (item.allDay || !item.startTime) return 'All day';
  return item.endTime ? `${item.startTime} to ${item.endTime}` : `from ${item.startTime}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m0: number) => MONTHS[m0];
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10 Aug 2026" or "10 to 11 Aug 2026". */
export function rangeText(startDate: string, endDate: string): string {
  const f = (s: string) => `${Number(s.slice(8))} ${SHORT_MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  return startDate === endDate ? f(startDate) : `${f(startDate)} to ${f(endDate)}`;
}
