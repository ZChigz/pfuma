// Filling a hostel's beds. Pure, so the plan can be shown before it is applied and tested without a database.

export interface Candidate { id: string; name: string; levelOrder: number; classId: string | null; className: string | null }
export interface FreeRoom { roomId: string; name: string; floor: string | null; free: string[] }
export interface Placement { studentId: string; bedId: string; roomId: string }

const byCandidate = (a: Candidate, b: Candidate) => a.levelOrder - b.levelOrder || (a.className ?? '').localeCompare(b.className ?? '') || a.name.localeCompare(b.name);
const byRoom = (a: FreeRoom, b: FreeRoom) => (a.floor ?? '').localeCompare(b.floor ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true });

/**
 * Fills the free beds of the rooms in order.
 *
 * With `keepFormsTogether` the learners go in form order: a form fills the rooms it has already started, then takes the next empty room, and
 * only when no empty room is left does it share a room with another form. So Form 1s sleep with Form 1s wherever the beds allow.
 * Without it the learners are spread over the free beds in name order, which mixes the forms.
 * Learners who do not fit are returned as `unplaced`.
 */
export function planFill(candidates: Candidate[], rooms: FreeRoom[], keepFormsTogether: boolean): { placements: Placement[]; unplaced: string[] } {
  const ordered = rooms.filter((r) => r.free.length > 0).sort(byRoom);
  const placements: Placement[] = [];
  const unplaced: string[] = [];

  if (!keepFormsTogether) {
    const beds = ordered.flatMap((r) => r.free.map((bedId) => ({ roomId: r.roomId, bedId })));
    [...candidates].sort((a, b) => a.name.localeCompare(b.name)).forEach((p, i) => {
      const bed = beds[i];
      if (bed) placements.push({ studentId: p.id, bedId: bed.bedId, roomId: bed.roomId });
      else unplaced.push(p.id);
    });
    return { placements, unplaced };
  }

  const left = new Map(ordered.map((r) => [r.roomId, [...r.free]]));
  const owner = new Map<string, number>();
  const open = (r: FreeRoom) => (left.get(r.roomId)?.length ?? 0) > 0;
  for (const p of [...candidates].sort(byCandidate)) {
    const room = ordered.find((r) => open(r) && owner.get(r.roomId) === p.levelOrder)
      ?? ordered.find((r) => open(r) && !owner.has(r.roomId))
      ?? ordered.find((r) => open(r));
    if (!room) { unplaced.push(p.id); continue; }
    const bedId = left.get(room.roomId)!.shift()!;
    if (!owner.has(room.roomId)) owner.set(room.roomId, p.levelOrder);
    placements.push({ studentId: p.id, bedId, roomId: room.roomId });
  }
  return { placements, unplaced };
}
