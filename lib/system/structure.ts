// Forms, streams and classes (Settings tab 3). Classes keep their history: one that has ever
// had students, subjects or marks attached is archived, never deleted.
import { ServiceError } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { classDisplayName, normalizeStream } from '@/lib/academic/rules';
import type { Db, ScopedDb } from '@/lib/scoped-db';

type Actor = { id: string; schoolId: string };

export const NO_STREAM = '';

export async function getStructure(db: ScopedDb, schoolId: string) {
  const open = await db.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
  const [levels, streams, classes, everRows, nowRows, school] = await Promise.all([
    db.level.findMany({ where: { schoolId }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true, category: true, active: true } }),
    db.stream.findMany({ where: { schoolId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.schoolClass.findMany({
      where: { schoolId },
      select: { id: true, name: true, levelId: true, stream: true, capacity: true, active: true, classTeacher: { select: { fullName: true } } },
    }),
    db.enrollment.groupBy({ by: ['classId'], where: { schoolId }, _count: { _all: true } }),
    open ? db.enrollment.groupBy({ by: ['classId'], where: { schoolId, termId: open.id, status: 'ACTIVE' }, _count: { _all: true } }) : Promise.resolve([]),
    db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { maxClassSize: true } }),
  ]);
  const ever = new Map(everRows.map((r) => [r.classId, r._count._all]));
  const now = new Map(nowRows.map((r) => [r.classId, r._count._all]));
  return {
    defaultCapacity: school.maxClassSize,
    levels,
    streams,
    classes: classes.map((c) => ({
      id: c.id, name: c.name, levelId: c.levelId, stream: c.stream, capacity: c.capacity, active: c.active,
      teacher: c.classTeacher?.fullName ?? null, studentsEver: ever.get(c.id) ?? 0, studentsNow: now.get(c.id) ?? 0,
    })),
  };
}

async function openTermId(tx: Db, schoolId: string) {
  return (await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } }))?.id ?? null;
}

async function currentStudents(tx: Db, schoolId: string, classId: string, termId: string | null) {
  if (!termId) return 0;
  return tx.enrollment.count({ where: { schoolId, classId, termId, status: 'ACTIVE' } });
}

// ─── Forms ───────────────────────────────────────────────────────────────────

export async function setForms(db: ScopedDb, actor: Actor, wanted: { id: string; active: boolean }[]) {
  const levels = await db.level.findMany({ where: { schoolId: actor.schoolId } });
  const byId = new Map(levels.map((l) => [l.id, l]));
  for (const w of wanted) if (!byId.has(w.id)) throw new ServiceError('One of the forms was not found', 404);

  const finalState = new Map(levels.map((l) => [l.id, l.active]));
  for (const w of wanted) finalState.set(w.id, w.active);
  if (!Array.from(finalState.values()).some(Boolean)) throw new ServiceError('The school needs at least one form switched on', 422);

  const changes = wanted.filter((w) => byId.get(w.id)!.active !== w.active);
  if (changes.length === 0) return getStructure(db, actor.schoolId);

  await db.$tx(async (tx) => {
    const term = await openTermId(tx, actor.schoolId);
    for (const c of changes) {
      const level = byId.get(c.id)!;
      if (!c.active) {
        const classes = await tx.schoolClass.findMany({ where: { schoolId: actor.schoolId, levelId: level.id, active: true } });
        let students = 0;
        for (const k of classes) students += await currentStudents(tx, actor.schoolId, k.id, term);
        if (students > 0) {
          throw new ServiceError(`${level.name} has ${students} student${students === 1 ? '' : 's'} in the open term, so it cannot be switched off. Move or promote them first.`, 409);
        }
        // A form that is off offers no classes; they are archived, with their history kept.
        for (const k of classes) {
          await tx.schoolClass.update({ where: { id: k.id }, data: { active: false } });
          await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'ARCHIVE_CLASS', entityType: 'SchoolClass', entityId: k.id, detail: `${k.name} (${level.name} switched off)` }, tx);
        }
      }
      await tx.level.update({ where: { id: level.id }, data: { active: c.active } });
    }
    await logAudit(
      {
        schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_FORMS', entityType: 'Level', entityId: actor.schoolId,
        detail: changes.map((c) => `${byId.get(c.id)!.name} ${c.active ? 'on' : 'off'}`).join(', '),
        before: Object.fromEntries(levels.map((l) => [l.name, l.active])), after: Object.fromEntries(levels.map((l) => [l.name, finalState.get(l.id)!])),
      },
      tx,
    );
  });
  return getStructure(db, actor.schoolId);
}

// ─── Streams ─────────────────────────────────────────────────────────────────

export async function addStream(db: ScopedDb, actor: Actor, rawName: string) {
  const name = normalizeStream(rawName);
  if (!name) throw new ServiceError('Enter a stream name', 422);
  if (await db.stream.findFirst({ where: { schoolId: actor.schoolId, name: { equals: name, mode: 'insensitive' } } })) {
    throw new ServiceError(`The stream ${name} already exists`, 409);
  }
  return db.$tx(async (tx) => {
    const s = await tx.stream.create({ data: { schoolId: actor.schoolId, name } });
    await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_STREAMS', entityType: 'Stream', entityId: s.id, detail: `Added ${name}` }, tx);
    return s;
  });
}

export async function renameStream(db: ScopedDb, actor: Actor, id: string, rawName: string) {
  const stream = await db.stream.findUnique({ where: { id } });
  if (!stream) throw new ServiceError('Stream not found', 404);
  const name = normalizeStream(rawName);
  if (!name) throw new ServiceError('Enter a stream name', 422);
  if (await db.stream.findFirst({ where: { schoolId: actor.schoolId, id: { not: id }, name: { equals: name, mode: 'insensitive' } } })) {
    throw new ServiceError(`The stream ${name} already exists`, 409);
  }
  return db.$tx(async (tx) => {
    // Classes follow the new name, so "Form 2 East" becomes "Form 2 Blue".
    const classes = await tx.schoolClass.findMany({ where: { schoolId: actor.schoolId, stream: { equals: stream.name, mode: 'insensitive' } }, include: { level: true } });
    for (const c of classes) {
      const newName = classDisplayName(c.level.name, name);
      if (await tx.schoolClass.findFirst({ where: { schoolId: actor.schoolId, id: { not: c.id }, name: newName } })) {
        throw new ServiceError(`A class called ${newName} already exists, so ${stream.name} cannot be renamed ${name}`, 409);
      }
      await tx.schoolClass.update({ where: { id: c.id }, data: { stream: name, name: newName } });
    }
    const s = await tx.stream.update({ where: { id }, data: { name } });
    await logAudit(
      { schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_STREAMS', entityType: 'Stream', entityId: id, detail: `Renamed ${stream.name} to ${name} (${classes.length} class${classes.length === 1 ? '' : 'es'} updated)`, before: { name: stream.name }, after: { name } },
      tx,
    );
    return s;
  });
}

export async function deleteStream(db: ScopedDb, actor: Actor, id: string) {
  const stream = await db.stream.findUnique({ where: { id } });
  if (!stream) throw new ServiceError('Stream not found', 404);
  const used = await db.schoolClass.count({ where: { schoolId: actor.schoolId, stream: { equals: stream.name, mode: 'insensitive' } } });
  if (used > 0) {
    throw new ServiceError(`${stream.name} is used by ${used} class${used === 1 ? '' : 'es'} (including archived ones), so it cannot be removed.`, 409);
  }
  await db.$tx(async (tx) => {
    await tx.stream.delete({ where: { id } });
    await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_STREAMS', entityType: 'Stream', entityId: id, detail: `Removed ${stream.name}` }, tx);
  });
}

// ─── Classes: the forms × streams grid ───────────────────────────────────────

export interface GridCell { levelId: string; stream: string; exists: boolean; capacity: number }

export async function saveClassGrid(db: ScopedDb, actor: Actor, cells: GridCell[]) {
  const [levels, streams] = await Promise.all([
    db.level.findMany({ where: { schoolId: actor.schoolId } }),
    db.stream.findMany({ where: { schoolId: actor.schoolId } }),
  ]);
  const levelById = new Map(levels.map((l) => [l.id, l]));
  const streamNames = new Map(streams.map((s) => [s.name.toLowerCase(), s.name]));

  // One entry per cell, with the stream spelt the way the school's list spells it.
  const seen = new Set<string>();
  const wanted = cells.map((c) => {
    const level = levelById.get(c.levelId);
    if (!level) throw new ServiceError('One of the forms was not found', 404);
    const stream = c.stream === NO_STREAM ? NO_STREAM : streamNames.get(c.stream.toLowerCase());
    if (stream === undefined) throw new ServiceError(`The stream "${c.stream}" is not in your list of streams`, 404);
    const key = `${c.levelId}|${stream.toLowerCase()}`;
    if (seen.has(key)) throw new ServiceError('The same class is listed twice', 422);
    seen.add(key);
    return { ...c, stream, level };
  });

  const result = { created: 0, updated: 0, archived: 0, deleted: 0, restored: 0 };

  await db.$tx(async (tx) => {
    const term = await openTermId(tx, actor.schoolId);
    for (const w of wanted) {
      const existing = await tx.schoolClass.findFirst({ where: { schoolId: actor.schoolId, levelId: w.levelId, stream: { equals: w.stream, mode: 'insensitive' } } });
      const name = classDisplayName(w.level.name, w.stream);

      if (w.exists) {
        if (!w.level.active) throw new ServiceError(`${w.level.name} is switched off. Switch it on before adding classes to it.`, 409);
        if (!existing) {
          const c = await tx.schoolClass.create({ data: { schoolId: actor.schoolId, name, levelId: w.levelId, stream: w.stream, capacity: w.capacity } });
          await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'CREATE_CLASS', entityType: 'SchoolClass', entityId: c.id, detail: `${name}, capacity ${w.capacity}` }, tx);
          result.created++;
        } else if (!existing.active || existing.capacity !== w.capacity) {
          await tx.schoolClass.update({ where: { id: existing.id }, data: { active: true, capacity: w.capacity } });
          await logAudit(
            {
              schoolId: actor.schoolId, actorId: actor.id, action: 'UPDATE_CLASS', entityType: 'SchoolClass', entityId: existing.id,
              detail: `${existing.name}${existing.active ? '' : ' restored'}, capacity ${w.capacity}`,
              before: { active: existing.active, capacity: existing.capacity }, after: { active: true, capacity: w.capacity },
            },
            tx,
          );
          if (existing.active) result.updated++; else result.restored++;
        }
        continue;
      }

      // Not wanted any more.
      if (!existing || !existing.active) continue;
      const now = await currentStudents(tx, actor.schoolId, existing.id, term);
      if (now > 0) throw new ServiceError(`${existing.name} has ${now} student${now === 1 ? '' : 's'} in the open term. Move them to another class before removing it.`, 409);

      const history = (await tx.enrollment.count({ where: { classId: existing.id } }))
        + (await tx.subjectAssignment.count({ where: { classId: existing.id } }))
        + (await tx.student.count({ where: { currentClassId: existing.id } }));
      if (history > 0) {
        await tx.schoolClass.update({ where: { id: existing.id }, data: { active: false } });
        await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'ARCHIVE_CLASS', entityType: 'SchoolClass', entityId: existing.id, detail: `${existing.name} (kept for its history)` }, tx);
        result.archived++;
      } else {
        await tx.schoolClass.delete({ where: { id: existing.id } });
        await logAudit({ schoolId: actor.schoolId, actorId: actor.id, action: 'DELETE_CLASS', entityType: 'SchoolClass', entityId: existing.id, detail: existing.name }, tx);
        result.deleted++;
      }
    }
  });
  return { ...result, structure: await getStructure(db, actor.schoolId) };
}
