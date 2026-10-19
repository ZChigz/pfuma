// The exam timetable's clash rules, as pure functions over the papers and who sits them.
//
//  Blocked:  a student who takes two subjects scheduled in the same session (same day, morning or afternoon);
//            a room that holds more candidates than its exam capacity (or is used by two papers in one session).
//  Warned:   a student with more than 2 papers in a day;
//            3 hours or more of exam time back to back.
// "Back to back" means the next paper starts within an hour of the last one ending.

export interface ClashPaper {
  id: string;
  name: string;
  subjectId: string;
  levelId: string;
  date: string;          // YYYY-MM-DD
  session: 'MORNING' | 'AFTERNOON';
  startTime: string;     // HH:MM
  durationMinutes: number;
  /** Rooms with how many candidates each can seat for an exam. */
  rooms: { roomId: string; roomName: string; examCapacity: number }[];
}

export interface Clash {
  severity: 'block' | 'warn';
  kind: 'STUDENT_SAME_SESSION' | 'ROOM_DOUBLE_BOOKED' | 'ROOM_CAPACITY' | 'NO_ROOMS' | 'STUDENT_MANY_PAPERS' | 'STUDENT_LONG_DAY';
  message: string;
  paperIds: string[];
  studentIds?: string[];
}

export const BACK_TO_BACK_GAP_MINUTES = 60;
export const LONG_DAY_MINUTES = 180;
export const MAX_PAPERS_PER_DAY = 2;

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const endTime = (p: Pick<ClashPaper, 'startTime' | 'durationMinutes'>): string => {
  const m = minutes(p.startTime) + p.durationMinutes;
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * `candidates` maps a paper to the students who sit it (the students of the paper's level who take its subject).
 * `names` is used only to word the messages.
 */
export function findClashes(papers: ClashPaper[], candidates: Map<string, string[]>, names: Map<string, string> = new Map()): Clash[] {
  const out: Clash[] = [];
  const byId = new Map(papers.map((p) => [p.id, p]));
  const sitting = (p: ClashPaper) => candidates.get(p.id) ?? [];
  const who = (ids: string[]) => ids.slice(0, 3).map((id) => names.get(id) ?? id).join(', ') + (ids.length > 3 ? ` and ${ids.length - 3} more` : '');
  const when = (p: ClashPaper) => `${p.date} ${p.session === 'MORNING' ? 'morning' : 'afternoon'}`;

  // A student in two papers of the same session.
  const bySession = new Map<string, ClashPaper[]>();
  for (const p of papers) (bySession.get(`${p.date}|${p.session}`) ?? bySession.set(`${p.date}|${p.session}`, []).get(`${p.date}|${p.session}`)!).push(p);
  Array.from(bySession.values()).forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const inB = new Set(sitting(b));
        const both = sitting(a).filter((s) => inB.has(s));
        if (both.length) out.push({ severity: 'block', kind: 'STUDENT_SAME_SESSION', paperIds: [a.id, b.id], studentIds: both, message: `${both.length} student${both.length === 1 ? '' : 's'} (${who(both)}) would sit ${a.name} and ${b.name} in the same session (${when(a)})` });
        // One room cannot hold two papers at once.
        for (const r of a.rooms) if (b.rooms.some((x) => x.roomId === r.roomId)) out.push({ severity: 'block', kind: 'ROOM_DOUBLE_BOOKED', paperIds: [a.id, b.id], message: `${r.roomName} is used for ${a.name} and ${b.name} in the same session (${when(a)})` });
      }
    }
  });

  // Seats.
  for (const p of papers) {
    const n = sitting(p).length;
    if (n === 0) continue;
    if (p.rooms.length === 0) { out.push({ severity: 'block', kind: 'NO_ROOMS', paperIds: [p.id], message: `${p.name} has no room yet (${n} candidates)` }); continue; }
    const seats = p.rooms.reduce((a, r) => a + r.examCapacity, 0);
    if (n > seats) out.push({ severity: 'block', kind: 'ROOM_CAPACITY', paperIds: [p.id], message: `${p.name}: ${n} candidates but only ${seats} seats in ${p.rooms.map((r) => r.roomName).join(', ')}` });
  }

  // A student's day.
  const days = new Map<string, Map<string, ClashPaper[]>>();
  for (const p of papers) {
    for (const s of sitting(p)) {
      const d = days.get(s) ?? days.set(s, new Map()).get(s)!;
      (d.get(p.date) ?? d.set(p.date, []).get(p.date)!).push(p);
    }
  }
  const many = new Map<string, string[]>();
  const long = new Map<string, string[]>();
  Array.from(days).forEach(([studentId, perDay]) => {
    Array.from(perDay).forEach(([date, list]) => {
      if (list.length > MAX_PAPERS_PER_DAY) { const k = `${date}|${list.map((p) => p.id).sort().join(',')}`; (many.get(k) ?? many.set(k, []).get(k)!).push(studentId); }
      const sorted = [...list].sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
      let chain = 0;
      let lastEnd = -Infinity;
      let ids: string[] = [];
      for (const p of sorted) {
        const start = minutes(p.startTime);
        if (start - lastEnd <= BACK_TO_BACK_GAP_MINUTES) { chain += p.durationMinutes; ids.push(p.id); } else { chain = p.durationMinutes; ids = [p.id]; }
        lastEnd = start + p.durationMinutes;
        if (chain >= LONG_DAY_MINUTES && ids.length > 1) { const k = `${date}|${[...ids].sort().join(',')}`; const arr = long.get(k) ?? long.set(k, []).get(k)!; if (!arr.includes(studentId)) arr.push(studentId); }
      }
    });
  });
  Array.from(many).forEach(([key, studentIds]) => {
    const [date, ids] = [key.split('|')[0]!, key.split('|')[1]!.split(',')];
    out.push({ severity: 'warn', kind: 'STUDENT_MANY_PAPERS', paperIds: ids, studentIds, message: `${studentIds.length} student${studentIds.length === 1 ? '' : 's'} (${who(studentIds)}) have more than ${MAX_PAPERS_PER_DAY} papers on ${date}` });
  });
  Array.from(long).forEach(([key, studentIds]) => {
    const [date, ids] = [key.split('|')[0]!, key.split('|')[1]!.split(',')];
    out.push({ severity: 'warn', kind: 'STUDENT_LONG_DAY', paperIds: ids, studentIds, message: `${studentIds.length} student${studentIds.length === 1 ? '' : 's'} (${who(studentIds)}) sit ${ids.map((i) => byId.get(i)?.name).join(' then ')} on ${date}: 3 hours or more back to back` });
  });
  return out;
}

/** Fills rooms in order, up to each room's exam capacity. Candidates left over are unseated. */
export function allocateSeats<T>(candidates: T[], rooms: { roomId: string; examCapacity: number }[]): { roomId: string; seats: { desk: number; candidate: T }[] }[] {
  const out: { roomId: string; seats: { desk: number; candidate: T }[] }[] = [];
  let next = 0;
  for (const r of rooms) {
    const seats: { desk: number; candidate: T }[] = [];
    while (seats.length < r.examCapacity && next < candidates.length) seats.push({ desk: seats.length + 1, candidate: candidates[next++]! });
    out.push({ roomId: r.roomId, seats });
  }
  return out;
}
