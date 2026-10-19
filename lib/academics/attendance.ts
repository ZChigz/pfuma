// Attendance registers.
//
// Daily register: hangs off the class and its class teacher (not an assignment), so a school can take attendance
// before its timetable exists. Everyone starts Present; the teacher taps the exceptions. A class of 45 takes under a
// minute on a phone, and the register also works offline: the phone keeps it and sends it when the signal returns
// (saveRegister is safe to send twice, and `changedAt` decides which of two versions wins).
//
// Rules kept here:
//  • only school days have a register (weekends, public holidays, days outside the term have none), never in the future;
//  • the class teacher marks their own class; Owner/Administrator ("*") any class;
//  • the same day: free. A later day (up to 7 days): a reason is needed and it is logged. Older: academics.attendance.correct;
//  • a closed term cannot be changed;
//  • students who are suspended (from Discipline) or on exeat (Hostel) are filled in and locked;
//  • when two devices changed the same register the later change wins and both versions are kept in the audit log;
//  • SMS to the primary guardian for an unexplained absence, and notices about chronic absence, are written in the same
//    transaction (so a failed save leaves none behind).
import { z } from 'zod';
import type { AttendanceStatus, ExcuseReason, RegisterSession } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { can } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import {
  deputyIds, dedupe, holds, idSchema, isFull, isoDateSchema, loadSettings, noteSchema, ownScope, reachableClassIds, resolveTerm, seesAllRegisters,
  timeSchema, todayInHarare, toDay, weekdayOf, type Actor,
} from '@/lib/academics/common';
import { NO_SCHOOL_TEXT, schoolDayInfo } from '@/lib/academics/school-days';
import { timetableInForce } from '@/lib/academics/timetable';

export const STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'SUSPENDED', 'EXEAT'] as const satisfies readonly AttendanceStatus[];
export const REASONS = ['SICK', 'FAMILY', 'SCHOOL_ACTIVITY', 'OTHER'] as const satisfies readonly ExcuseReason[];
export const REASON_LABEL: Record<ExcuseReason, string> = { SICK: 'Sick', FAMILY: 'Family', SCHOOL_ACTIVITY: 'School activity', OTHER: 'Other' };
/** A register older than this many days needs the Deputy (academics.attendance.correct). */
export const CORRECTION_WINDOW_DAYS = 7;
const LOCKED: AttendanceStatus[] = ['SUSPENDED', 'EXEAT'];

export function harareDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const daysBetween = (a: string, b: string) => Math.round((toDay(b).getTime() - toDay(a).getTime()) / 86_400_000);

// ─── Input ───────────────────────────────────────────────────────────────────

export const EntrySchema = z
  .object({
    studentId: idSchema,
    status: z.enum(STATUSES),
    reason: z.enum(REASONS).nullish(),
    reasonNote: z.string().trim().max(200).nullish(),
    arrivalTime: timeSchema.nullish(),
  })
  .superRefine((e, ctx) => {
    if (e.status === 'EXCUSED' && !e.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Choose why the student is excused' });
    if (e.status === 'LATE' && !e.arrivalTime) ctx.addIssue({ code: 'custom', path: ['arrivalTime'], message: 'Enter the time the student arrived' });
    if (e.arrivalTime && e.status !== 'LATE') ctx.addIssue({ code: 'custom', path: ['arrivalTime'], message: 'An arrival time is only for a late student' });
    if (e.reason && e.status !== 'ABSENT' && e.status !== 'EXCUSED') ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is only for an absent or excused student' });
  });
export type EntryInput = z.input<typeof EntrySchema>;

const common = {
  entries: z.array(EntrySchema).min(1, 'The register has no students').max(300),
  /** When the marks were last changed on the device. Offline registers keep this so the right version wins. */
  changedAt: z.string().datetime({ offset: true }).optional(),
  deviceId: z.string().trim().max(64).optional(),
  /** Why an earlier day's register is being changed. */
  correctionReason: noteSchema(300),
};

export const SaveRegisterSchema = z.object({
  classId: idSchema,
  date: isoDateSchema,
  session: z.enum(['AM', 'PM']).default('AM'),
  ...common,
});
export type SaveRegisterInput = z.input<typeof SaveRegisterSchema>;

export const SaveLessonSchema = z.object({ slotId: idSchema, date: isoDateSchema, ...common });
export type SaveLessonInput = z.input<typeof SaveLessonSchema>;

export type SaveOutcome = 'created' | 'updated' | 'unchanged' | 'kept_newer';
export interface SaveResult { outcome: SaveOutcome; registerId: string; present: number; late: number; absent: number; excused: number; locked: number; kept?: string }

// ─── Who is locked ───────────────────────────────────────────────────────────

/**
 * Students on exeat on this date. The Hostel module is not built yet; when it is, this is the one place that returns
 * them and the register fills them in as On exeat (locked) without any other change.
 */
export async function exeatStudentIds(...args: [tx: Db, date: string, studentIds: string[]]): Promise<Set<string>> {
  void args;
  return new Set();
}

/** Students under an approved suspension on the date (from Discipline) or on exeat (from Hostel): locked in the register. */
export async function lockedStudents(tx: Db, schoolId: string, date: string, studentIds: string[]): Promise<Map<string, 'SUSPENDED' | 'EXEAT'>> {
  const out = new Map<string, 'SUSPENDED' | 'EXEAT'>();
  const susp = await tx.disciplineAction.findMany({
    where: { schoolId, type: 'SUSPENSION', status: 'APPROVED', studentId: { in: studentIds }, startDate: { lte: toDay(date) }, endDate: { gte: toDay(date) } },
    select: { studentId: true },
  });
  for (const s of susp) out.set(s.studentId, 'SUSPENDED');
  for (const id of Array.from(await exeatStudentIds(tx, date, studentIds))) if (!out.has(id)) out.set(id, 'EXEAT');
  return out;
}

// ─── Who may edit when ───────────────────────────────────────────────────────

export type EditMode = 'FREE' | 'REASON' | 'DEPUTY' | 'LOCKED';

/** The rule on changing a register: today free, up to 7 days with a reason, older only for the Deputy. */
export function editModeFor(registerDate: string, editedOn: string, hasCorrectPermission: boolean, termClosed: boolean): { mode: EditMode; message: string | null } {
  if (termClosed) return { mode: 'LOCKED', message: 'This term is closed, so its registers cannot be changed.' };
  const age = daysBetween(registerDate, editedOn);
  if (age <= 0) return { mode: 'FREE', message: null };
  if (age <= CORRECTION_WINDOW_DAYS) return { mode: 'REASON', message: 'This register is from an earlier day. Give a reason for the change; it is logged.' };
  if (hasCorrectPermission) return { mode: 'REASON', message: `This register is more than ${CORRECTION_WINDOW_DAYS} days old. Give a reason; it is logged.` };
  return { mode: 'DEPUTY', message: `Registers older than ${CORRECTION_WINDOW_DAYS} days can only be changed by the Deputy.` };
}

/** The day a change counts as made: when the phone recorded it (offline), but never in the future or more than a week back. */
export function effectiveEditDate(changedAt: string | undefined, now = new Date()): string {
  if (!changedAt) return harareDate(now);
  const t = new Date(changedAt).getTime();
  const capped = Math.min(t, now.getTime());
  return now.getTime() - capped > CORRECTION_WINDOW_DAYS * 86_400_000 ? harareDate(now) : harareDate(new Date(capped));
}

const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(toDay(iso));
const shortDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(toDay(iso));

// ─── The sheet a teacher marks ───────────────────────────────────────────────

export interface SheetStudent {
  id: string; fullName: string; admissionNumber: string; photoUrl: string | null; gender: string | null;
  status: AttendanceStatus; reason: ExcuseReason | null; arrivalTime: string | null; locked: boolean;
}

export interface Sheet {
  kind: 'DAILY' | 'LESSON';
  classId: string | null; className: string; slotId: string | null; lesson: string | null;
  date: string; dateLabel: string; session: RegisterSession; sessions: RegisterSession[];
  term: { id: string; name: string; status: string };
  schoolDay: boolean; noSchoolReason: string | null;
  editMode: EditMode; editMessage: string | null; canMark: boolean;
  register: { id: string; markedBy: string; markedAt: string; changedAt: string; deviceId: string | null } | null;
  students: SheetStudent[];
}

async function termOf(tx: Db, schoolId: string, date: string) {
  return tx.academicTerm.findFirst({ where: { schoolId, startDate: { lte: toDay(date) }, endDate: { gte: toDay(date) } } });
}

/** May this person mark (or correct) the register of the class: its class teacher, or the Deputy / administrator. */
function canMarkClass(user: Actor, ownClassIds: string[], classId: string) {
  return isFull(user) || holds(user, 'academics.attendance.correct') || ownClassIds.includes(classId);
}

/** Registers are read by their class teacher and by the people who look after every class; anyone else gets "not found". */
async function assertRegisterReachable(tx: Db, user: Actor, classId: string, termId: string): Promise<void> {
  if (!(await tx.schoolClass.findFirst({ where: { id: classId }, select: { id: true } }))) throw new ServiceError('Class not found', 404);
  if (seesAllRegisters(user)) return;
  const own = (await ownScope(tx, user, termId)).classTeacherOf;
  if (!own.includes(classId)) throw new ServiceError('Class not found', 404);
}

async function classRoster(tx: Db, termId: string, classId: string) {
  const rows = await tx.enrollment.findMany({
    where: { termId, classId, status: 'ACTIVE' },
    select: { student: { select: { id: true, fullName: true, surname: true, firstName: true, admissionNumber: true, photoUrl: true, gender: true } } },
  });
  return rows.map((r) => r.student).sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName));
}

/** The daily register of a class for a date: the roster with each student's mark (everyone starts Present). */
export async function dailySheet(user: Actor, classId: string, dateIn: string | undefined, session: 'AM' | 'PM' = 'AM'): Promise<Sheet> {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, date);
  return db.$tx(async (tx) => {
    const term = await termOf(tx, user.schoolId, date);
    const reachTerm = term ?? (await resolveTerm(tx, user.schoolId));
    await assertRegisterReachable(tx, user, classId, reachTerm.id);
    const klass = await tx.schoolClass.findFirst({ where: { id: classId }, select: { name: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    const settings = await loadSettings(tx, user.schoolId);
    const sessions: RegisterSession[] = settings.afternoonRegister ? ['AM', 'PM'] : ['AM'];
    const own = isFull(user) ? [] : (await ownScope(tx, user, reachTerm.id)).classTeacherOf;
    const mayMark = (holds(user, 'academics.attendance.mark') || holds(user, 'academics.attendance.correct')) && canMarkClass(user, own, classId);
    const base: Sheet = {
      kind: 'DAILY', classId, className: klass.name, slotId: null, lesson: null, date, dateLabel: dayLabel(date), session, sessions, term: { id: reachTerm.id, name: reachTerm.name, status: reachTerm.status },
      schoolDay: day.isSchoolDay, noSchoolReason: day.reason ? NO_SCHOOL_TEXT[day.reason] : null, editMode: 'LOCKED', editMessage: null, canMark: false, register: null, students: [],
    };
    if (!term || !day.isSchoolDay) return { ...base, editMessage: base.noSchoolReason };
    const edit = editModeFor(date, todayInHarare(), can(user, 'academics.attendance.correct'), term.status === 'CLOSED');
    const roster = await classRoster(tx, term.id, classId);
    const reg = await tx.attendanceRegister.findFirst({ where: { classId, date: toDay(date), session, slotId: null }, include: { entries: true } });
    const markedBy = reg ? await tx.user.findFirst({ where: { id: reg.markedById }, select: { fullName: true } }) : null;
    const locks = await lockedStudents(tx, user.schoolId, date, roster.map((s) => s.id));
    const byStudent = new Map(reg?.entries.map((e) => [e.studentId, e]) ?? []);
    return {
      ...base, term: { id: term.id, name: term.name, status: term.status }, editMode: edit.mode, editMessage: edit.message, canMark: mayMark && edit.mode !== 'LOCKED' && edit.mode !== 'DEPUTY',
      register: reg ? { id: reg.id, markedBy: markedBy?.fullName ?? '', markedAt: reg.markedAt.toISOString(), changedAt: reg.changedAt.toISOString(), deviceId: reg.deviceId } : null,
      students: roster.map((s) => {
        const lock = locks.get(s.id);
        const e = byStudent.get(s.id);
        return {
          id: s.id, fullName: s.fullName, admissionNumber: s.admissionNumber, photoUrl: s.photoUrl, gender: s.gender,
          status: lock ?? e?.status ?? 'PRESENT', reason: lock ? null : e?.reason ?? null, arrivalTime: lock ? null : e?.arrivalTime ?? null, locked: !!lock,
        };
      }),
    };
  });
}

// ─── Saving ──────────────────────────────────────────────────────────────────

interface Ctx {
  user: Actor;
  term: { id: string; name: string };
  kind: 'DAILY' | 'LESSON';
  classId: string | null;
  slotId: string | null;
  session: RegisterSession;
  date: string;
  label: string;
  roster: Map<string, { fullName: string }>;
  entries: z.output<typeof EntrySchema>[];
  changedAt: Date;
  deviceId: string | null;
  correctionReason: string | undefined;
  mode: EditMode;
}

type Norm = { studentId: string; status: AttendanceStatus; reason: ExcuseReason | null; reasonNote: string | null; arrivalTime: string | null };

/** Everyone on the roster gets a mark (missing = present); locked students are forced to their lock; unknown students are refused. */
function normalise(ctx: Ctx, locks: Map<string, 'SUSPENDED' | 'EXEAT'>): Norm[] {
  const given = new Map<string, z.output<typeof EntrySchema>>();
  for (const e of ctx.entries) {
    if (!ctx.roster.has(e.studentId)) throw new ServiceError('One of the students is not in this register', 422);
    if (given.has(e.studentId)) throw new ServiceError('A student appears twice in the register', 422);
    given.set(e.studentId, e);
  }
  return Array.from(ctx.roster.keys()).map((studentId) => {
    const lock = locks.get(studentId);
    const e = given.get(studentId);
    if (lock) return { studentId, status: lock, reason: null, reasonNote: null, arrivalTime: null };
    if (e && LOCKED.includes(e.status)) throw new ServiceError(`${ctx.roster.get(studentId)!.fullName} is not suspended or on exeat on this day`, 422);
    return { studentId, status: e?.status ?? 'PRESENT', reason: e?.reason ?? null, reasonNote: e?.reasonNote ?? null, arrivalTime: e?.arrivalTime ?? null };
  });
}

const sameMark = (a: { status: string; reason: string | null; arrivalTime: string | null }, b: { status: string; reason: string | null; arrivalTime: string | null }) =>
  a.status === b.status && (a.reason ?? null) === (b.reason ?? null) && (a.arrivalTime ?? null) === (b.arrivalTime ?? null);

const tally = (n: Norm[]) => ({
  present: n.filter((e) => e.status === 'PRESENT').length, late: n.filter((e) => e.status === 'LATE').length,
  absent: n.filter((e) => e.status === 'ABSENT').length, excused: n.filter((e) => e.status === 'EXCUSED').length,
  locked: n.filter((e) => LOCKED.includes(e.status)).length,
});

async function persist(tx: Db, ctx: Ctx, locks: Map<string, 'SUSPENDED' | 'EXEAT'>): Promise<SaveResult> {
  const { user } = ctx;
  const norm = normalise(ctx, locks);
  const existing = await tx.attendanceRegister.findFirst({
    where: ctx.kind === 'LESSON' ? { slotId: ctx.slotId!, date: toDay(ctx.date) } : { classId: ctx.classId!, date: toDay(ctx.date), session: ctx.session, slotId: null },
    include: { entries: true },
  });
  const counts = tally(norm);
  const nameOf = (id: string) => ctx.roster.get(id)?.fullName ?? id;
  const version = (rows: { studentId: string; status: string; reason: string | null; arrivalTime: string | null }[]) =>
    rows.filter((r) => r.status !== 'PRESENT').map((r) => ({ student: nameOf(r.studentId), status: r.status, reason: r.reason, arrivalTime: r.arrivalTime }));
  const tag = `${ctx.label}, ${dayLabel(ctx.date)}${ctx.kind === 'DAILY' ? (ctx.session === 'AM' ? ', morning' : ', afternoon') : ''}`;
  const summary = `${counts.absent} absent, ${counts.late} late, ${counts.excused} excused${counts.locked ? `, ${counts.locked} locked` : ''}`;

  if (!existing) {
    if (ctx.mode === 'REASON' && !ctx.correctionReason) throw new ServiceError('Give a reason for marking the register after its day', 422);
    const reg = await tx.attendanceRegister.create({
      data: {
        schoolId: user.schoolId, termId: ctx.term.id, classId: ctx.classId, slotId: ctx.slotId, date: toDay(ctx.date), session: ctx.session, markedById: user.id,
        // markedAt is when the teacher marked it (on the phone, if offline), which is what 'on time' is judged by.
        markedAt: ctx.changedAt, changedAt: ctx.changedAt, deviceId: ctx.deviceId,
      },
    });
    await tx.attendanceEntry.createMany({ data: norm.map((e) => ({ schoolId: user.schoolId, registerId: reg.id, ...e })) });
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: ctx.mode === 'FREE' ? 'MARK_REGISTER' : 'CORRECT_REGISTER', entityType: 'AttendanceRegister', entityId: reg.id,
        detail: `${tag}: register marked (${summary})${ctx.correctionReason ? `. Reason: ${ctx.correctionReason}` : ''}`, after: { counts, marks: version(norm) },
      },
      tx,
    );
    await afterSave(tx, ctx, norm, existing);
    return { outcome: 'created', registerId: reg.id, ...counts };
  }

  const incomingNewer = ctx.changedAt.getTime() >= existing.changedAt.getTime();
  const before = existing.entries.map((e) => ({ studentId: e.studentId, status: e.status as string, reason: e.reason as string | null, arrivalTime: e.arrivalTime }));
  const prior = new Map(before.map((b) => [b.studentId, b]));
  const changed = norm.filter((n) => !prior.get(n.studentId) || !sameMark(prior.get(n.studentId)!, n));
  const sameDevice = !!ctx.deviceId && ctx.deviceId === existing.deviceId;

  if (!incomingNewer) {
    // The register on the server is newer than this one (another device saved later). Keep it; keep this version in the log.
    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'REGISTER_CONFLICT', entityType: 'AttendanceRegister', entityId: existing.id,
        detail: `${tag}: an older version of the register arrived late and was not applied (the newer version stays)`,
        before: { kept: 'newer', changedAt: existing.changedAt.toISOString(), deviceId: existing.deviceId, marks: version(before) },
        after: { discarded: 'older', changedAt: ctx.changedAt.toISOString(), deviceId: ctx.deviceId, marks: version(norm) },
      },
      tx,
    );
    return { outcome: 'kept_newer', registerId: existing.id, ...tally(before.map((b) => ({ ...b, reasonNote: null })) as Norm[]), kept: 'A newer version of this register was already saved.' };
  }

  if (changed.length === 0) {
    if (ctx.changedAt.getTime() > existing.changedAt.getTime()) await tx.attendanceRegister.update({ where: { id: existing.id }, data: { changedAt: ctx.changedAt, syncedAt: new Date() } });
    return { outcome: 'unchanged', registerId: existing.id, ...counts };
  }

  if (ctx.mode === 'REASON' && !ctx.correctionReason) throw new ServiceError('Give a reason for changing the register after its day', 422);
  for (const n of changed) {
    await tx.attendanceEntry.upsert({
      where: { registerId_studentId: { registerId: existing.id, studentId: n.studentId } },
      update: { status: n.status, reason: n.reason, reasonNote: n.reasonNote, arrivalTime: n.arrivalTime },
      create: { schoolId: user.schoolId, registerId: existing.id, ...n },
    });
  }
  await tx.attendanceRegister.update({ where: { id: existing.id }, data: { changedAt: ctx.changedAt, deviceId: ctx.deviceId, syncedAt: new Date(), markedById: user.id } });
  const conflict = !!existing.deviceId && !!ctx.deviceId && !sameDevice;
  await logAudit(
    {
      schoolId: user.schoolId, actorId: user.id, action: conflict ? 'REGISTER_CONFLICT' : ctx.mode === 'FREE' ? 'MARK_REGISTER' : 'CORRECT_REGISTER', entityType: 'AttendanceRegister', entityId: existing.id,
      detail: conflict
        ? `${tag}: the register was changed on two devices; the later change was kept and the earlier version is recorded here`
        : `${tag}: register ${ctx.mode === 'FREE' ? 'changed' : 'corrected'} for ${changed.length} student${changed.length === 1 ? '' : 's'} (${summary})${ctx.correctionReason ? `. Reason: ${ctx.correctionReason}` : ''}`,
      before: { changedAt: existing.changedAt.toISOString(), deviceId: existing.deviceId, marks: version(before) },
      after: { changedAt: ctx.changedAt.toISOString(), deviceId: ctx.deviceId, marks: version(norm), changed: changed.map((c) => ({ student: nameOf(c.studentId), from: prior.get(c.studentId)?.status ?? null, to: c.status })), reason: ctx.correctionReason ?? null },
    },
    tx,
  );
  await afterSave(tx, ctx, norm, existing);
  return { outcome: 'updated', registerId: existing.id, ...counts };
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

async function afterSave(tx: Db, ctx: Ctx, norm: Norm[], existing: { entries: { studentId: string; status: string; reason: string | null }[] } | null) {
  if (ctx.kind === 'LESSON') return lessonAlerts(tx, ctx, norm);
  const { user } = ctx;
  const settings = await loadSettings(tx, user.schoolId);

  // SMS to the primary guardian for an absence without a reason (only when Communication is on and the alert is on).
  const smsOn = settings.absentSmsAlert && !user.disabledModules?.includes('communication');
  const unexplained = norm.filter((n) => n.status === 'ABSENT' && !n.reason);
  const outboxKey = (studentId: string) => `absent:${studentId}:${ctx.date}:${ctx.session}`;
  if (existing) {
    // Someone who is no longer absent-without-a-reason must not get a message that has not gone out yet.
    const resolved = norm.filter((n) => !(n.status === 'ABSENT' && !n.reason)).map((n) => outboxKey(n.studentId));
    if (resolved.length) await tx.messageOutbox.deleteMany({ where: { dedupeKey: { in: resolved }, status: 'QUEUED' } });
  }
  if (smsOn && unexplained.length) {
    const links = await tx.studentGuardian.findMany({
      where: { studentId: { in: unexplained.map((u) => u.studentId) }, isPrimary: true, canReceiveSms: true },
      select: { studentId: true, guardianId: true, guardian: { select: { phone: true } } },
    });
    const school = await tx.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { name: true } });
    let queued = 0;
    for (const l of links) {
      const r = await tx.messageOutbox.createMany({
        data: [{
          schoolId: user.schoolId, toPhone: l.guardian.phone, studentId: l.studentId, guardianId: l.guardianId, dedupeKey: outboxKey(l.studentId),
          body: `${school.name}: ${ctx.roster.get(l.studentId)!.fullName} (${ctx.label}) was marked absent today, ${shortDate(ctx.date)}. Please contact the school.`,
        }],
        skipDuplicates: true,
      });
      queued += r.count;
    }
    if (queued) await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'QUEUE_SMS', entityType: 'AttendanceRegister', entityId: ctx.classId!, detail: `${ctx.label}: ${queued} absence message${queued === 1 ? '' : 's'} queued for guardians`, after: { queued } }, tx);
  }

  // Chronic absence: notify the class teacher and the Deputy.
  if (settings.chronicAbsenceAlert && ctx.session === 'AM') {
    await chronicAlerts(tx, ctx, settings, norm);
  }
}

/** Attendance % = (present + late) of the days the student could attend (suspension and exeat days are left out). */
export function attendanceRate(counts: { present: number; late: number; absent: number; excused: number }): number | null {
  const total = counts.present + counts.late + counts.absent + counts.excused;
  return total === 0 ? null : Math.round(((counts.present + counts.late) / total) * 1000) / 10;
}

async function chronicAlerts(tx: Db, ctx: Ctx, settings: { consecutiveAbsentDays: number; attendanceThresholdPct: number }, norm: Norm[]) {
  const { user } = ctx;
  const absentNow = norm.filter((n) => n.status === 'ABSENT' || n.status === 'EXCUSED').map((n) => n.studentId);
  if (absentNow.length === 0) return;
  const regs = await tx.attendanceRegister.findMany({
    where: { classId: ctx.classId!, termId: ctx.term.id, session: 'AM', slotId: null, date: { lte: toDay(ctx.date) } },
    orderBy: { date: 'desc' }, select: { id: true, date: true },
  });
  const entries = await tx.attendanceEntry.findMany({ where: { registerId: { in: regs.map((r) => r.id) }, studentId: { in: absentNow } }, select: { registerId: true, studentId: true, status: true } });
  const byStudent = new Map<string, Map<string, string>>();
  for (const e of entries) byStudent.set(e.studentId, (byStudent.get(e.studentId) ?? new Map()).set(e.registerId, e.status));
  const ct = await tx.classTeacher.findUnique({ where: { classId_termId: { classId: ctx.classId!, termId: ctx.term.id } }, select: { userId: true } });
  const recipients = dedupe([ct?.userId, ...(await deputyIds(tx, user.schoolId))].filter((x): x is string => !!x));
  if (recipients.length === 0) return;
  const week = `${ctx.date.slice(0, 4)}-W${Math.ceil((Number(ctx.date.slice(5, 7)) * 31 + Number(ctx.date.slice(8, 10))) / 7)}`;
  for (const studentId of absentNow) {
    const marks = byStudent.get(studentId) ?? new Map();
    let streak = 0;
    for (const r of regs) {
      const st = marks.get(r.id);
      if (st === 'ABSENT' || st === 'EXCUSED') streak++; else break;
    }
    const name = ctx.roster.get(studentId)!.fullName;
    if (streak >= settings.consecutiveAbsentDays) {
      await notifyUsers(tx, user.schoolId, recipients, {
        type: 'CHRONIC_ABSENCE', title: `${name} has been absent ${streak} days in a row`, body: `${ctx.label}, up to ${shortDate(ctx.date)}`, link: `/academics/attendance?classId=${ctx.classId}`,
        dedupeKey: `absent-streak:${studentId}:${ctx.date}`,
      });
    }
    const all = Array.from(marks.values());
    const rate = attendanceRate({ present: all.filter((s) => s === 'PRESENT').length, late: all.filter((s) => s === 'LATE').length, absent: all.filter((s) => s === 'ABSENT').length, excused: all.filter((s) => s === 'EXCUSED').length });
    if (all.length >= 5 && rate !== null && rate < settings.attendanceThresholdPct) {
      await notifyUsers(tx, user.schoolId, recipients, {
        type: 'CHRONIC_ABSENCE', title: `${name} is below ${settings.attendanceThresholdPct}% attendance`, body: `${ctx.label}: ${rate}% this term`, link: `/academics/attendance?classId=${ctx.classId}`,
        dedupeKey: `low-attendance:${studentId}:${ctx.term.id}:${week}`,
      });
    }
  }
}

/** A student present in the morning register but absent from a lesson is a possible truant: tell the class teacher and Deputy. */
async function lessonAlerts(tx: Db, ctx: Ctx, norm: Norm[]) {
  const absent = norm.filter((n) => n.status === 'ABSENT').map((n) => n.studentId);
  if (absent.length === 0) return;
  const flagged = await truants(tx, ctx.date, absent);
  if (flagged.size === 0) return;
  const { user } = ctx;
  const classes = await tx.enrollment.findMany({ where: { termId: ctx.term.id, studentId: { in: Array.from(flagged) }, status: 'ACTIVE' }, select: { studentId: true, classId: true } });
  const teachers = await tx.classTeacher.findMany({ where: { termId: ctx.term.id, classId: { in: dedupe(classes.map((c) => c.classId)) } }, select: { classId: true, userId: true } });
  const deputies = await deputyIds(tx, user.schoolId);
  for (const studentId of Array.from(flagged)) {
    const classId = classes.find((c) => c.studentId === studentId)?.classId;
    const to = dedupe([teachers.find((t) => t.classId === classId)?.userId, ...deputies].filter((x): x is string => !!x));
    await notifyUsers(tx, user.schoolId, to, {
      type: 'TRUANCY', title: `Possible truancy: ${ctx.roster.get(studentId)!.fullName}`, body: `Present this morning but absent from ${ctx.label} on ${shortDate(ctx.date)}`,
      link: `/academics/attendance?classId=${classId}`, dedupeKey: `truancy:${studentId}:${ctx.slotId}:${ctx.date}`,
    });
  }
}

/** Of these students, those who were marked Present or Late in the morning register of the date. */
async function truants(tx: Db, date: string, studentIds: string[]): Promise<Set<string>> {
  const rows = await tx.attendanceEntry.findMany({
    where: { studentId: { in: studentIds }, status: { in: ['PRESENT', 'LATE'] }, register: { date: toDay(date), session: 'AM', slotId: null } },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

// ─── The public entry points ─────────────────────────────────────────────────

function parseTime(changedAt: string | undefined): Date {
  const now = new Date();
  if (!changedAt) return now;
  const t = new Date(changedAt);
  // A clock that is wrong (or forged) into the future counts as now.
  return t.getTime() > now.getTime() ? now : t;
}

/** Saves a class's daily register. Safe to send twice; an older version never replaces a newer one. */
export async function saveRegister(user: Actor, raw: SaveRegisterInput): Promise<SaveResult> {
  const input = SaveRegisterSchema.parse(raw);
  if (input.date > todayInHarare()) throw new ServiceError('A register cannot be marked for a day that has not come yet', 422);
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, input.date);
  if (!day.isSchoolDay || !day.term) throw new ServiceError(day.reason ? NO_SCHOOL_TEXT[day.reason] : 'There is no school on this day', 409);
  return db.$tx(async (tx) => {
    const term = await tx.academicTerm.findFirstOrThrow({ where: { id: day.term!.id } });
    const klass = await tx.schoolClass.findFirst({ where: { id: input.classId }, select: { id: true, name: true, active: true } });
    if (!klass) throw new ServiceError('Class not found', 404);
    const settings = await loadSettings(tx, user.schoolId);
    if (input.session === 'PM' && !settings.afternoonRegister) throw new ServiceError('This school does not take an afternoon register', 409);
    if (!canMarkClass(user, isFull(user) ? [] : (await ownScope(tx, user, term.id)).classTeacherOf, klass.id)) throw new ServiceError('Class not found', 404);
    const changedAt = parseTime(input.changedAt);
    const edit = editModeFor(input.date, effectiveEditDate(input.changedAt), can(user, 'academics.attendance.correct'), term.status === 'CLOSED');
    if (edit.mode === 'LOCKED') throw new ServiceError(edit.message!, 409);
    if (edit.mode === 'DEPUTY') throw new ServiceError(edit.message!, 403);
    const roster = new Map((await classRoster(tx, term.id, klass.id)).map((s) => [s.id, { fullName: s.fullName }]));
    const locks = await lockedStudents(tx, user.schoolId, input.date, Array.from(roster.keys()));
    return persist(tx, {
      user, term, kind: 'DAILY', classId: klass.id, slotId: null, session: input.session, date: input.date, label: klass.name, roster, entries: input.entries,
      changedAt, deviceId: input.deviceId ?? null, correctionReason: input.correctionReason, mode: edit.mode,
    }, locks);
  });
}

export const SyncSchema = z.object({
  registers: z.array(z.object({ ref: z.string().max(64).optional() }).passthrough()).min(1).max(50),
});
export interface SyncItemResult { ref: string | null; ok: boolean; outcome?: SaveOutcome; message?: string; status?: number; registerId?: string }

/** Saves registers (and lesson registers) that were marked offline. Each is saved on its own; one failure does not stop the rest. */
export async function syncRegisters(user: Actor, raw: unknown): Promise<SyncItemResult[]> {
  const { registers } = SyncSchema.parse(raw);
  const out: SyncItemResult[] = [];
  for (const item of registers) {
    const ref = (item.ref as string | undefined) ?? null;
    try {
      const r = 'slotId' in item ? await saveLessonRegister(user, item as SaveLessonInput) : await saveRegister(user, item as SaveRegisterInput);
      out.push({ ref, ok: true, outcome: r.outcome, registerId: r.registerId, message: r.kept });
    } catch (err) {
      if (err instanceof ServiceError) out.push({ ref, ok: false, status: err.status, message: err.message });
      else if (err instanceof z.ZodError) out.push({ ref, ok: false, status: 422, message: err.issues[0]?.message ?? 'The register is not valid' });
      else throw err;
    }
  }
  return out;
}

// ─── Per-lesson registers ────────────────────────────────────────────────────

/** Who the person teaching a slot is on a date: the assignment active that day (or a cover teacher), so history keeps its teacher. */
async function lessonContext(tx: Db, user: Actor, slotId: string, date: string) {
  const slot = await tx.timetableSlot.findFirst({
    where: { id: slotId },
    include: {
      period: { select: { dayOfWeek: true, periodNo: true, start: true } }, timetable: { select: { termId: true, status: true } },
      assignment: { include: { subject: { select: { id: true, name: true, shortName: true } }, class: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } } },
    },
  });
  if (!slot) throw new ServiceError('Lesson not found', 404);
  if (weekdayOf(date) !== slot.period.dayOfWeek) throw new ServiceError('This lesson is not on that day of the week', 422);
  const inForce = await timetableInForce(tx, slot.timetable.termId, date);
  if (!inForce || inForce.id !== slot.timetableId) throw new ServiceError('That lesson was not on the timetable in force on that day', 409);
  const a = slot.assignment;
  // The assignment in force that day for the same subject and class/group (a teacher may have been replaced since).
  const inForceAssignment = await tx.teacherAssignment.findFirst({
    where: { termId: a.termId, subjectId: a.subjectId, ...(a.classId ? { classId: a.classId } : { groupId: a.groupId }), startDate: { lte: toDay(date) }, OR: [{ endDate: null }, { endDate: { gte: toDay(date) } }] },
    select: { id: true, teacherId: true, coTeacherId: true },
  });
  const cover = await tx.coverLesson.findFirst({ where: { slotId, date: toDay(date) }, select: { coverTeacherId: true } });
  const teachers = [inForceAssignment?.teacherId ?? a.teacherId, inForceAssignment?.coTeacherId ?? a.coTeacherId, cover?.coverTeacherId].filter((x): x is string => !!x);
  return { slot, teachers };
}

async function lessonStudents(tx: Db, termId: string, a: { subjectId: string; classId: string | null; groupId: string | null }) {
  if (a.groupId) {
    const rows = await tx.teachingGroupStudent.findMany({ where: { groupId: a.groupId }, select: { student: { select: { id: true, fullName: true, surname: true, firstName: true, admissionNumber: true, photoUrl: true, gender: true } } } });
    return rows.map((r) => r.student);
  }
  // The class's students who take the subject: its stored choices, or the form's core subjects.
  const klass = await tx.schoolClass.findFirstOrThrow({ where: { id: a.classId! }, select: { levelId: true } });
  const core = await tx.subjectLevel.findFirst({ where: { levelId: klass.levelId, subjectId: a.subjectId, type: 'CORE' } });
  const roster = await classRoster(tx, termId, a.classId!);
  if (core) return roster;
  const taking = await tx.studentSubject.findMany({ where: { termId, subjectId: a.subjectId, studentId: { in: roster.map((s) => s.id) } }, select: { studentId: true } });
  const set = new Set(taking.map((t) => t.studentId));
  return roster.filter((s) => set.has(s.id));
}

export async function lessonSheet(user: Actor, slotId: string, dateIn?: string): Promise<Sheet> {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, date);
  return db.$tx(async (tx) => {
    const settings = await loadSettings(tx, user.schoolId);
    if (!settings.perLessonAttendance) throw new ServiceError('Per-lesson attendance is switched off for this school', 409);
    const { slot, teachers } = await lessonContext(tx, user, slotId, date);
    const mine = isFull(user) || teachers.includes(user.id);
    if (!mine && !holds(user, 'academics.attendance.view')) throw new ServiceError('Lesson not found', 404);
    const a = slot.assignment;
    const term = await tx.academicTerm.findFirstOrThrow({ where: { id: a.termId } });
    const label = `${a.subject.shortName ?? a.subject.name} · ${a.class?.name ?? a.group?.name}`;
    const students = await lessonStudents(tx, term.id, a);
    const reg = await tx.attendanceRegister.findFirst({ where: { slotId, date: toDay(date) }, include: { entries: true } });
    const markedBy = reg ? await tx.user.findFirst({ where: { id: reg.markedById }, select: { fullName: true } }) : null;
    const by = new Map(reg?.entries.map((e) => [e.studentId, e]) ?? []);
    const edit = editModeFor(date, todayInHarare(), can(user, 'academics.attendance.correct'), term.status === 'CLOSED');
    const base = day.isSchoolDay && day.term ? edit : { mode: 'LOCKED' as EditMode, message: day.reason ? NO_SCHOOL_TEXT[day.reason] : null };
    return {
      kind: 'LESSON', classId: a.classId, className: a.class?.name ?? a.group?.name ?? '', slotId, lesson: label, date, dateLabel: dayLabel(date), session: 'LESSON', sessions: ['LESSON'],
      term: { id: term.id, name: term.name, status: term.status }, schoolDay: day.isSchoolDay, noSchoolReason: day.reason ? NO_SCHOOL_TEXT[day.reason] : null,
      editMode: base.mode, editMessage: base.message, canMark: holds(user, 'academics.attendance.mark') && mine && base.mode !== 'LOCKED' && base.mode !== 'DEPUTY',
      register: reg ? { id: reg.id, markedBy: markedBy?.fullName ?? '', markedAt: reg.markedAt.toISOString(), changedAt: reg.changedAt.toISOString(), deviceId: reg.deviceId } : null,
      students: students.sort((x, y) => x.surname.localeCompare(y.surname) || x.firstName.localeCompare(y.firstName)).map((s) => ({
        id: s.id, fullName: s.fullName, admissionNumber: s.admissionNumber, photoUrl: s.photoUrl, gender: s.gender,
        status: by.get(s.id)?.status ?? 'PRESENT', reason: by.get(s.id)?.reason ?? null, arrivalTime: by.get(s.id)?.arrivalTime ?? null, locked: false,
      })),
    };
  });
}

export async function saveLessonRegister(user: Actor, raw: SaveLessonInput): Promise<SaveResult> {
  const input = SaveLessonSchema.parse(raw);
  if (input.date > todayInHarare()) throw new ServiceError('A register cannot be marked for a day that has not come yet', 422);
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, input.date);
  if (!day.isSchoolDay || !day.term) throw new ServiceError(day.reason ? NO_SCHOOL_TEXT[day.reason] : 'There is no school on this day', 409);
  return db.$tx(async (tx) => {
    const settings = await loadSettings(tx, user.schoolId);
    if (!settings.perLessonAttendance) throw new ServiceError('Per-lesson attendance is switched off for this school', 409);
    const { slot, teachers } = await lessonContext(tx, user, input.slotId, input.date);
    if (!isFull(user) && !teachers.includes(user.id)) throw new ServiceError('Lesson not found', 404);
    const a = slot.assignment;
    const term = await tx.academicTerm.findFirstOrThrow({ where: { id: a.termId } });
    if (day.term!.id !== term.id) throw new ServiceError('This lesson belongs to another term', 409);
    const edit = editModeFor(input.date, effectiveEditDate(input.changedAt), can(user, 'academics.attendance.correct'), term.status === 'CLOSED');
    if (edit.mode === 'LOCKED') throw new ServiceError(edit.message!, 409);
    if (edit.mode === 'DEPUTY') throw new ServiceError(edit.message!, 403);
    const students = await lessonStudents(tx, term.id, a);
    const roster = new Map(students.map((s) => [s.id, { fullName: s.fullName }]));
    const locks = await lockedStudents(tx, user.schoolId, input.date, Array.from(roster.keys()));
    return persist(tx, {
      user, term, kind: 'LESSON', classId: a.classId, slotId: slot.id, session: 'LESSON', date: input.date, label: `${a.subject.shortName ?? a.subject.name} · ${a.class?.name ?? a.group?.name}`,
      roster, entries: input.entries, changedAt: parseTime(input.changedAt), deviceId: input.deviceId ?? null, correctionReason: input.correctionReason, mode: edit.mode,
    }, locks);
  });
}

/** The lessons a teacher can open a register for on a date (their timetable for that weekday), with whether it is marked. */
export async function myLessons(user: Actor, dateIn?: string) {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const settings = await loadSettings(tx, user.schoolId);
    if (!settings.perLessonAttendance) return { enabled: false, date, lessons: [] };
    const term = await termOf(tx, user.schoolId, date);
    const tt = term ? await timetableInForce(tx, term.id, date) : null;
    if (!tt) return { enabled: true, date, lessons: [] };
    const slots = await tx.timetableSlot.findMany({
      where: { timetableId: tt.id, period: { dayOfWeek: weekdayOf(date) } },
      include: { period: { select: { periodNo: true, start: true, end: true } }, assignment: { include: { subject: { select: { name: true, shortName: true } }, class: { select: { name: true } }, group: { select: { name: true } } } } },
      orderBy: { period: { periodNo: 'asc' } },
    });
    const regs = await tx.attendanceRegister.findMany({ where: { slotId: { in: slots.map((s) => s.id) }, date: toDay(date) }, select: { slotId: true } });
    const marked = new Set(regs.map((r) => r.slotId));
    const mine: typeof slots = [];
    for (const s of slots) {
      if (isFull(user)) { mine.push(s); continue; }
      const { teachers } = await lessonContext(tx, user, s.id, date);
      if (teachers.includes(user.id)) mine.push(s);
    }
    return {
      enabled: true, date,
      lessons: mine.map((s) => ({ slotId: s.id, periodNo: s.period.periodNo, start: s.period.start, end: s.period.end, subject: s.assignment.subject.shortName ?? s.assignment.subject.name, target: s.assignment.class?.name ?? s.assignment.group?.name ?? '', marked: marked.has(s.id) })),
    };
  });
}

/** Possible truants of a date: present in the morning, absent from a lesson that day. */
export async function truancyList(user: Actor, dateIn?: string) {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await termOf(tx, user.schoolId, date);
    if (!term) return [];
    const reach = seesAllRegisters(user) ? 'all' : await reachableClassIds(tx, user, term.id);
    const lessonAbsences = await tx.attendanceEntry.findMany({
      where: { status: 'ABSENT', register: { date: toDay(date), session: 'LESSON' } },
      select: { studentId: true, student: { select: { fullName: true } }, register: { select: { slot: { select: { period: { select: { periodNo: true } }, assignment: { select: { subject: { select: { shortName: true, name: true } } } } } } } } },
    });
    const flagged = await truants(tx, date, dedupe(lessonAbsences.map((l) => l.studentId)));
    const enrol = await tx.enrollment.findMany({ where: { termId: term.id, studentId: { in: Array.from(flagged) }, status: 'ACTIVE' }, select: { studentId: true, classId: true, class: { select: { name: true } } } });
    const cls = new Map(enrol.map((e) => [e.studentId, e]));
    return lessonAbsences
      .filter((l) => flagged.has(l.studentId) && (reach === 'all' || reach.includes(cls.get(l.studentId)?.classId ?? '')))
      .map((l) => ({ studentId: l.studentId, student: l.student.fullName, className: cls.get(l.studentId)?.class.name ?? '', lesson: l.register.slot ? `Period ${l.register.slot.period.periodNo} ${l.register.slot.assignment.subject.shortName ?? l.register.slot.assignment.subject.name}` : '' }));
  });
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export async function classAttendanceSummary(user: Actor, classId: string, termId?: string) {
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await resolveTerm(tx, user.schoolId, termId);
    await assertRegisterReachable(tx, user, classId, term.id);
    const [regs, roster] = await Promise.all([
      tx.attendanceRegister.findMany({ where: { classId, termId: term.id, session: 'AM', slotId: null }, select: { id: true, date: true } }),
      classRoster(tx, term.id, classId),
    ]);
    const entries = await tx.attendanceEntry.findMany({ where: { registerId: { in: regs.map((r) => r.id) } }, select: { studentId: true, status: true } });
    const rows = roster.map((s) => {
      const mine = entries.filter((e) => e.studentId === s.id);
      const c = {
        present: mine.filter((e) => e.status === 'PRESENT').length, late: mine.filter((e) => e.status === 'LATE').length,
        absent: mine.filter((e) => e.status === 'ABSENT').length, excused: mine.filter((e) => e.status === 'EXCUSED').length,
      };
      return { id: s.id, fullName: s.fullName, ...c, rate: attendanceRate(c) };
    });
    const all = { present: rows.reduce((a, r) => a + r.present, 0), late: rows.reduce((a, r) => a + r.late, 0), absent: rows.reduce((a, r) => a + r.absent, 0), excused: rows.reduce((a, r) => a + r.excused, 0) };
    return { term: { id: term.id, name: term.name }, registersMarked: regs.length, classRate: attendanceRate(all), students: rows };
  });
}

/** Registers marked vs not marked by class, present % by form and the absentees, for the Head and Deputy. */
export async function dailySummary(user: Actor, dateIn?: string) {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  const db = getScopedDb(user.schoolId, user.id);
  const day = await schoolDayInfo(db, user, date);
  return db.$tx(async (tx) => {
    const term = day.term ? await tx.academicTerm.findFirst({ where: { id: day.term.id } }) : null;
    if (!term || !day.isSchoolDay) return { date, schoolDay: false, reason: day.reason ? NO_SCHOOL_TEXT[day.reason] : null, classes: [], forms: [], absentees: [], marked: 0, total: 0 };
    const reach = seesAllRegisters(user) ? 'all' : await reachableClassIds(tx, user, term.id);
    const classes = await tx.schoolClass.findMany({
      where: { active: true, level: { active: true }, ...(reach === 'all' ? {} : { id: { in: reach } }) },
      orderBy: [{ level: { order: 'asc' } }, { stream: 'asc' }], select: { id: true, name: true, level: { select: { id: true, name: true } } },
    });
    const ids = classes.map((c) => c.id);
    const [regs, teachers, sizes] = await Promise.all([
      tx.attendanceRegister.findMany({ where: { termId: term.id, classId: { in: ids }, date: toDay(date), session: 'AM', slotId: null }, include: { entries: { include: { student: { select: { fullName: true } } } } } }),
      tx.classTeacher.findMany({ where: { termId: term.id, classId: { in: ids } }, select: { classId: true, user: { select: { fullName: true } } } }),
      tx.enrollment.groupBy({ by: ['classId'], where: { termId: term.id, status: 'ACTIVE', classId: { in: ids } }, _count: { _all: true } }),
    ]);
    const marker = new Map((await tx.user.findMany({ where: { id: { in: dedupe(regs.map((r) => r.markedById)) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    const absentIds = regs.flatMap((r) => r.entries.filter((e) => e.status === 'ABSENT' || e.status === 'EXCUSED').map((e) => e.studentId));
    const phones = absentIds.length
      ? await tx.studentGuardian.findMany({ where: { studentId: { in: absentIds }, isPrimary: true }, select: { studentId: true, guardian: { select: { phone: true } } } })
      : [];
    const phone = new Map(phones.map((p) => [p.studentId, p.guardian.phone]));
    const rows = classes.map((c) => {
      const r = regs.find((x) => x.classId === c.id);
      const t = r ? tally(r.entries.map((e) => ({ ...e, reasonNote: null }))) : null;
      return {
        id: c.id, name: c.name, form: c.level.name, formId: c.level.id, teacher: teachers.find((x) => x.classId === c.id)?.user.fullName ?? null,
        marked: !!r, markedBy: r ? marker.get(r.markedById) ?? null : null, markedAt: r?.markedAt.toISOString() ?? null, size: sizes.find((s) => s.classId === c.id)?._count._all ?? 0,
        present: t ? t.present + t.late : 0, absent: t ? t.absent + t.excused : 0, rate: t ? attendanceRate(t) : null,
      };
    });
    const forms = Array.from(new Set(rows.filter((r) => r.marked).map((r) => r.formId))).map((fid) => {
      const f = rows.filter((r) => r.formId === fid && r.marked);
      const present = f.reduce((a, r) => a + r.present, 0), absent = f.reduce((a, r) => a + r.absent, 0);
      return { formId: fid, form: f[0]!.form, present, absent, rate: present + absent ? Math.round((present / (present + absent)) * 1000) / 10 : null };
    });
    const absentees = regs.flatMap((r) => r.entries.filter((e) => e.status === 'ABSENT' || e.status === 'EXCUSED').map((e) => ({
      studentId: e.studentId, student: e.student.fullName, className: classes.find((c) => c.id === r.classId)?.name ?? '', status: e.status, reason: e.reason,
      guardianPhone: holds(user, 'academics.attendance.view') ? phone.get(e.studentId) ?? null : null,
    })));
    return { date, schoolDay: true, reason: null, classes: rows, forms, absentees, marked: rows.filter((r) => r.marked).length, total: rows.length };
  });
}

/** Reminds the class teachers of classes that have not marked today's register. */
export async function remindRegisters(user: Actor, classIds: string[], dateIn?: string) {
  const date = isoDateSchema.parse(dateIn ?? todayInHarare());
  if (date !== todayInHarare()) throw new ServiceError('Reminders are only for today', 422);
  return getScopedDb(user.schoolId, user.id).$tx(async (tx) => {
    const term = await termOf(tx, user.schoolId, date);
    if (!term) throw new ServiceError('There is no school today', 409);
    const done = await tx.attendanceRegister.findMany({ where: { termId: term.id, date: toDay(date), session: 'AM', slotId: null, classId: { in: classIds } }, select: { classId: true } });
    const doneSet = new Set(done.map((d) => d.classId));
    const todo = classIds.filter((c) => !doneSet.has(c));
    const teachers = await tx.classTeacher.findMany({ where: { termId: term.id, classId: { in: todo } }, select: { classId: true, userId: true, class: { select: { name: true } } } });
    const bucket = Math.floor(Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Harare' }).format(new Date())) / 3);
    let reminded = 0;
    for (const t of teachers) {
      reminded += await notifyUsers(tx, user.schoolId, [t.userId], {
        type: 'REGISTER_REMINDER', title: `Please mark today's register for ${t.class.name}`, link: `/academics/attendance?classId=${t.classId}`, dedupeKey: `register-reminder:${t.classId}:${date}:${bucket}`,
      });
    }
    await logAudit({ schoolId: user.schoolId, actorId: user.id, action: 'REMIND_REGISTER', entityType: 'AcademicTerm', entityId: term.id, detail: `Reminded ${reminded} class teacher${reminded === 1 ? '' : 's'} to mark the register`, after: { classes: todo.length, reminded } }, tx);
    return { reminded, withoutTeacher: todo.length - teachers.length };
  });
}

/** Whether the class teacher still has to mark today's register (for their dashboard). */
export async function registerDue(user: Actor) {
  const db = getScopedDb(user.schoolId, user.id);
  const today = todayInHarare();
  const day = await schoolDayInfo(db, user, today);
  if (!day.isSchoolDay || !day.term || day.term.status === 'CLOSED') return [];
  return db.$tx(async (tx) => {
    const mine = await tx.classTeacher.findMany({ where: { termId: day.term!.id, userId: user.id }, select: { classId: true, class: { select: { name: true } } } });
    if (mine.length === 0) return [];
    const done = await tx.attendanceRegister.findMany({ where: { termId: day.term!.id, date: toDay(today), session: 'AM', slotId: null, classId: { in: mine.map((m) => m.classId) } }, select: { classId: true } });
    const doneSet = new Set(done.map((d) => d.classId));
    return mine.filter((m) => !doneSet.has(m.classId)).map((m) => ({ classId: m.classId, className: m.class.name }));
  });
}

