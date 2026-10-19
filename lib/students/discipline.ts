// Discipline: any teacher can log an incident in under a minute; serious actions go to the Head and the
// student's record shows the whole history.
//  • Corporal punishment is not an action that exists (prohibited under the Education Amendment Act, 2020).
//  • Warnings, detention, manual work, counselling and "guardian called in" are saved straight away.
//  • A suspension needs approval (students.discipline.approve). A person who holds it approves their own
//    suspension; anyone else's waits as PENDING and the approvers are told. The approver is recorded.
//  • The student's status becomes Suspended for the dates and returns to Active by itself the day after the end date.
//  • An expulsion is only a recommendation until the Head records a decision; confirming it starts the leaving process.
import type { DisciplineActionType, IncidentCategory, IncidentLocation, IncidentSeverity } from '@prisma/client';
import { z } from 'zod';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { notifyUsers } from '@/lib/system/notifications';
import { approverIds, idSchema, isoDateSchema, loadReachable, noteSchema } from '@/lib/students/common';
import { startLeavingTx } from '@/lib/students/leavers';
import { todayInHarare } from '@/lib/students/registration';
import { canSuspend, isAtSchool } from '@/lib/students/rules';
import { studentScope } from '@/lib/students/scope';

type Actor = AccessUser & { fullName?: string };

export const INCIDENT_LOCATIONS = ['CLASSROOM', 'DORMITORY', 'SPORTS_FIELD', 'DINING_HALL', 'OFF_CAMPUS', 'OTHER'] as const satisfies readonly IncidentLocation[];
export const INCIDENT_LOCATION_LABEL: Record<IncidentLocation, string> = {
  CLASSROOM: 'Classroom', DORMITORY: 'Dormitory', SPORTS_FIELD: 'Sports field', DINING_HALL: 'Dining hall', OFF_CAMPUS: 'Off campus', OTHER: 'Other',
};
export const INCIDENT_CATEGORIES = [
  'LATE_COMING', 'ABSENT_WITHOUT_LEAVE', 'UNIFORM', 'HOMEWORK', 'DISRESPECT', 'BULLYING', 'FIGHTING', 'THEFT', 'VANDALISM',
  'SUBSTANCE_USE', 'PHONE_USE', 'ABSCONDING', 'EXAM_DISHONESTY', 'OTHER',
] as const satisfies readonly IncidentCategory[];
export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> = {
  LATE_COMING: 'Late coming', ABSENT_WITHOUT_LEAVE: 'Absent without leave', UNIFORM: 'Uniform', HOMEWORK: 'Homework', DISRESPECT: 'Disrespect',
  BULLYING: 'Bullying', FIGHTING: 'Fighting', THEFT: 'Theft', VANDALISM: 'Vandalism', SUBSTANCE_USE: 'Substance use', PHONE_USE: 'Phone use',
  ABSCONDING: 'Absconding / out of bounds', EXAM_DISHONESTY: 'Exam dishonesty', OTHER: 'Other',
};
export const SEVERITIES = ['MINOR', 'MODERATE', 'SERIOUS'] as const satisfies readonly IncidentSeverity[];
export const SEVERITY_LABEL: Record<IncidentSeverity, string> = { MINOR: 'Minor', MODERATE: 'Moderate', SERIOUS: 'Serious' };
export const ACTION_TYPES = [
  'VERBAL_WARNING', 'WRITTEN_WARNING', 'DETENTION', 'MANUAL_WORK', 'COUNSELLING_REFERRAL', 'GUARDIAN_CALLED_IN', 'SUSPENSION', 'EXPULSION_RECOMMENDED',
] as const satisfies readonly DisciplineActionType[];
export const ACTION_LABEL: Record<DisciplineActionType, string> = {
  VERBAL_WARNING: 'Verbal warning', WRITTEN_WARNING: 'Written warning', DETENTION: 'Detention', MANUAL_WORK: 'Manual work',
  COUNSELLING_REFERRAL: 'Counselling referral', GUARDIAN_CALLED_IN: 'Guardian called in', SUSPENSION: 'Suspension', EXPULSION_RECOMMENDED: 'Expulsion recommended',
};

/** Actions that wait for a decision before they take effect. */
const NEEDS_DECISION: readonly DisciplineActionType[] = ['SUSPENSION', 'EXPULSION_RECOMMENDED'];

// ─── Input ───────────────────────────────────────────────────────────────────

/** A local date and time as typed in the form (Harare time, no daylight saving): 2026-03-02T10:30. */
const localDateTime = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Enter the date and time').transform((v, ctx) => {
  const d = new Date(`${v.replace(' ', 'T')}:00+02:00`);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Enter a real date and time' });
    return z.NEVER;
  }
  return d;
});

const ActionInput = z
  .object({
    type: z.enum(ACTION_TYPES, { error: 'Choose an action' }),
    /** Which of the students the action applies to; all of them when left out. */
    studentIds: z.array(idSchema).min(1).optional(),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    notes: noteSchema(500),
  })
  .superRefine((a, ctx) => {
    if (a.type !== 'SUSPENSION') return;
    if (!a.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'A suspension needs a start date' });
    if (!a.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'A suspension needs an end date' });
    if (a.startDate && a.endDate && a.endDate < a.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The end date cannot be before the start date' });
  });

export const RecordIncidentSchema = z.object({
  studentIds: z.array(idSchema).min(1, 'Choose at least one student').max(50),
  occurredAt: localDateTime.refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'The incident cannot be in the future'),
  location: z.enum(INCIDENT_LOCATIONS, { error: 'Choose where it happened' }),
  category: z.enum(INCIDENT_CATEGORIES, { error: 'Choose a category' }),
  severity: z.enum(SEVERITIES, { error: 'Choose how serious it was' }),
  description: z.string().trim().min(5, 'Say what happened in a few words').max(2000),
  witnesses: noteSchema(300),
  actions: z.array(ActionInput).max(8).default([]),
});
export type RecordIncidentInput = z.input<typeof RecordIncidentSchema>;

// ─── Record an incident ──────────────────────────────────────────────────────

export async function recordIncident(user: Actor, rawInput: RecordIncidentInput) {
  const input = RecordIncidentSchema.parse(rawInput);
  const { schoolId } = user;
  const canApprove = can(user, 'students.discipline.approve');
  const today = todayInHarare();

  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const open = await tx.academicTerm.findFirst({ where: { schoolId, status: 'OPEN' }, select: { id: true } });
    const students = await loadReachable(tx, user, input.studentIds, open?.id);
    const away = students.filter((s) => !isAtSchool(s.status));
    if (away.length) throw new ServiceError(`Incidents are recorded for students at the school: ${away.map((s) => s.fullName).join(', ')}`, 409);
    const byId = new Map(students.map((s) => [s.id, s]));

    for (const a of input.actions) {
      for (const id of a.studentIds ?? []) if (!byId.has(id)) throw new ServiceError('An action names a student who is not part of this incident', 422);
      if (a.type === 'SUSPENSION') {
        for (const id of a.studentIds ?? input.studentIds) {
          const s = byId.get(id)!;
          if (!canSuspend(s.status)) throw new ServiceError(`${s.fullName} is already suspended`, 409);
          const open = await tx.disciplineAction.findFirst({ where: { studentId: id, type: 'SUSPENSION', status: { in: ['PENDING', 'APPROVED'] } } });
          if (open) throw new ServiceError(`${s.fullName} already has a suspension waiting or under way`, 409);
        }
      }
    }

    const incident = await tx.disciplineIncident.create({
      data: {
        schoolId, occurredAt: input.occurredAt, location: input.location, category: input.category, severity: input.severity,
        description: input.description, witnesses: input.witnesses ?? null, recordedById: user.id,
        students: { create: students.map((s) => ({ schoolId, studentId: s.id })) },
      },
    });

    const waiting: { studentName: string; type: DisciplineActionType }[] = [];
    const created: { id: string; studentId: string; type: DisciplineActionType; status: string }[] = [];
    for (const a of input.actions) {
      for (const studentId of a.studentIds ?? input.studentIds) {
        const decides = NEEDS_DECISION.includes(a.type);
        // A suspension is approved at once by someone who may approve; an expulsion is only ever a recommendation.
        const approveNow = a.type === 'SUSPENSION' && canApprove;
        const status = !decides ? 'RECORDED' : approveNow ? 'APPROVED' : 'PENDING';
        const row = await tx.disciplineAction.create({
          data: {
            schoolId, incidentId: incident.id, studentId, type: a.type, status,
            startDate: a.startDate ? new Date(`${a.startDate}T00:00:00Z`) : null, endDate: a.endDate ? new Date(`${a.endDate}T00:00:00Z`) : null,
            notes: a.notes ?? null, requestedById: user.id,
            approvedById: approveNow ? user.id : null, decidedAt: approveNow ? new Date() : null,
          },
        });
        created.push({ id: row.id, studentId, type: a.type, status });
        if (status === 'PENDING') waiting.push({ studentName: byId.get(studentId)!.fullName, type: a.type });
      }
    }

    await logAudit(
      {
        schoolId, actorId: user.id, action: 'RECORD_INCIDENT', entityType: 'DisciplineIncident', entityId: incident.id,
        detail: `${INCIDENT_CATEGORY_LABEL[input.category]} (${SEVERITY_LABEL[input.severity]}): ${students.map((s) => s.fullName).join(', ')}`,
        after: {
          category: input.category, severity: input.severity, location: input.location, studentIds: students.map((s) => s.id),
          actions: created.map((c) => ({ type: c.type, studentId: c.studentId, status: c.status })),
        },
      },
      tx,
    );

    // Tell the people who decide: serious incidents, and anything waiting for approval.
    if (input.severity === 'SERIOUS' || waiting.length) {
      const approvers = await approverIds(tx, schoolId, 'students.discipline.approve', user.id);
      await notifyUsers(tx, schoolId, approvers, {
        type: waiting.length ? 'DISCIPLINE_WAITING' : 'SERIOUS_INCIDENT',
        title: waiting.length
          ? `${waiting.length} discipline decision${waiting.length === 1 ? '' : 's'} waiting: ${waiting.map((w) => ACTION_LABEL[w.type]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
          : `Serious incident: ${INCIDENT_CATEGORY_LABEL[input.category]}`,
        body: students.map((s) => s.fullName).slice(0, 5).join(', '),
        link: students.length === 1 ? `/students/${students[0]!.id}?tab=discipline` : '/students/discipline',
      });
    }

    await startDueSuspensions(tx, schoolId, today);
    return { incidentId: incident.id, actions: created };
  });
}

// ─── Decide a suspension or an expulsion ─────────────────────────────────────

export const DecideActionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE'), notes: noteSchema(500) }),
  z.object({ decision: z.literal('REJECT'), notes: noteSchema(500) }),
  z.object({
    decision: z.literal('CONFIRM_EXPULSION'),
    decisionDate: isoDateSchema,
    /** The approval reference from the ministry or the responsible authority, when there is one. */
    authorityRef: noteSchema(100),
    notes: noteSchema(500),
  }),
  z.object({ decision: z.literal('DECLINE_EXPULSION'), decisionDate: isoDateSchema, notes: noteSchema(500) }),
]);
export type DecideActionInput = z.input<typeof DecideActionSchema>;

export async function decideAction(user: Actor, actionId: string, rawInput: DecideActionInput) {
  if (!can(user, 'students.discipline.approve')) throw new ServiceError('Forbidden', 403);
  const input = DecideActionSchema.parse(rawInput);
  const { schoolId } = user;
  const today = todayInHarare();

  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const action = await tx.disciplineAction.findFirst({ where: { id: actionId, schoolId }, include: { student: { select: { id: true, fullName: true, status: true } } } });
    if (!action) throw new ServiceError('Discipline action not found', 404);
    if (action.status !== 'PENDING') throw new ServiceError('This action has already been decided', 409);
    const isSuspension = action.type === 'SUSPENSION';
    const isExpulsion = action.type === 'EXPULSION_RECOMMENDED';
    if (!isSuspension && !isExpulsion) throw new ServiceError('Only suspensions and expulsion recommendations need a decision', 409);
    if (isSuspension !== (input.decision === 'APPROVE' || input.decision === 'REJECT')) {
      throw new ServiceError(isSuspension ? 'A suspension is approved or rejected' : 'An expulsion recommendation is confirmed or declined', 422);
    }

    const approved = input.decision === 'APPROVE' || input.decision === 'CONFIRM_EXPULSION';
    if (isSuspension && approved && !canSuspend(action.student.status)) {
      throw new ServiceError(`${action.student.fullName} cannot be suspended now (status ${action.student.status.toLowerCase()})`, 409);
    }
    const updated = await tx.disciplineAction.update({
      where: { id: actionId },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED', approvedById: user.id, decidedAt: new Date(),
        notes: input.notes ? [action.notes, input.notes].filter(Boolean).join(' — ') : action.notes,
        ...(isExpulsion ? {
          decision: approved ? 'CONFIRMED' : 'DECLINED',
          decisionDate: new Date(`${(input as { decisionDate: string }).decisionDate}T00:00:00Z`),
          authorityRef: input.decision === 'CONFIRM_EXPULSION' ? input.authorityRef ?? null : null,
        } : {}),
      },
    });
    await logAudit(
      {
        schoolId, actorId: user.id, action: 'DECIDE_INCIDENT_ACTION', entityType: 'DisciplineAction', entityId: actionId,
        detail: `${action.student.fullName}: ${ACTION_LABEL[action.type]} ${approved ? 'approved' : 'declined'}`,
        before: { status: action.status }, after: { status: updated.status, approvedById: user.id },
      },
      tx,
    );

    if (isSuspension && approved) await startDueSuspensions(tx, schoolId, today);
    if (input.decision === 'CONFIRM_EXPULSION') {
      await startLeavingTx(tx, user, {
        studentId: action.studentId, reason: 'EXPELLED', lastDay: input.decisionDate,
        reasonNote: input.authorityRef ? `Expulsion confirmed. Authority reference ${input.authorityRef}.` : 'Expulsion confirmed.',
      });
    }
    await notifyUsers(tx, schoolId, [action.requestedById], {
      type: 'DISCIPLINE_DECIDED', title: `${ACTION_LABEL[action.type]} for ${action.student.fullName} was ${approved ? 'approved' : 'declined'}`,
      link: `/students/${action.studentId}?tab=discipline`,
    });
    return { status: updated.status };
  });
}

// ─── Guardian meetings ───────────────────────────────────────────────────────

export const GuardianMeetingSchema = z.object({
  meetingDate: isoDateSchema,
  attendees: z.string().trim().min(2, 'Say who attended').max(300),
  outcome: z.string().trim().min(2, 'Record the outcome').max(1000),
  /** Key of the signed letter, uploaded as a student document. */
  letterKey: z.string().trim().max(200).optional(),
});

/** Records a guardian meeting against a "guardian called in" action; the signed letter upload is optional. */
export async function recordGuardianMeeting(user: Actor, actionId: string, rawInput: z.input<typeof GuardianMeetingSchema>) {
  const input = GuardianMeetingSchema.parse(rawInput);
  const { schoolId } = user;
  if (input.letterKey && !input.letterKey.startsWith(`sdoc:${schoolId}:`)) throw new ServiceError('That file does not belong to this school', 422);
  return getScopedDb(schoolId, user.id).$tx(async (tx) => {
    const action = await tx.disciplineAction.findFirst({ where: { id: actionId, schoolId }, include: { student: { select: { id: true, fullName: true } } } });
    if (!action) throw new ServiceError('Discipline action not found', 404);
    await loadReachable(tx, user, [action.studentId]);
    if (action.type !== 'GUARDIAN_CALLED_IN') throw new ServiceError('Meetings are recorded against a "guardian called in" action', 409);
    const updated = await tx.disciplineAction.update({
      where: { id: actionId },
      data: { meetingDate: new Date(`${input.meetingDate}T00:00:00Z`), meetingAttendees: input.attendees, meetingOutcome: input.outcome, meetingLetterKey: input.letterKey ?? action.meetingLetterKey },
    });
    await logAudit(
      {
        schoolId, actorId: user.id, action: 'RECORD_GUARDIAN_MEETING', entityType: 'DisciplineAction', entityId: actionId,
        detail: `${action.student.fullName}: guardian meeting on ${input.meetingDate}`,
        before: { meetingDate: action.meetingDate?.toISOString().slice(0, 10) ?? null }, after: { meetingDate: input.meetingDate },
      },
      tx,
    );
    return updated;
  });
}

// ─── Suspensions start and end by themselves ─────────────────────────────────

/**
 * Approved suspensions whose dates have come: the student becomes Suspended from the start date and Active
 * again the day after the end date. Safe to run as often as you like; it only acts on what is due. The
 * audit entries name the person who approved the suspension, because nobody is signed in when it runs.
 */
export async function startDueSuspensions(tx: Db, schoolId: string, today = todayInHarare()) {
  const day = new Date(`${today}T00:00:00Z`);
  const starting = await tx.disciplineAction.findMany({
    where: { schoolId, type: 'SUSPENSION', status: 'APPROVED', startDate: { lte: day }, endDate: { gte: day }, student: { status: 'ACTIVE' } },
    include: { student: { select: { id: true, fullName: true } } },
  });
  for (const a of starting) {
    await tx.student.update({ where: { id: a.studentId }, data: { status: 'SUSPENDED' } });
    await logAudit(
      {
        schoolId, actorId: a.approvedById ?? a.requestedById, action: 'SUSPEND_STUDENT', entityType: 'Student', entityId: a.studentId,
        detail: `${a.student.fullName} suspended until ${a.endDate!.toISOString().slice(0, 10)}`,
        before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED', actionId: a.id, from: a.startDate!.toISOString().slice(0, 10), until: a.endDate!.toISOString().slice(0, 10) },
      },
      tx,
    );
  }
  return starting.length;
}

export async function endDueSuspensions(tx: Db, schoolId: string, today = todayInHarare()) {
  const day = new Date(`${today}T00:00:00Z`);
  const ending = await tx.disciplineAction.findMany({
    where: { schoolId, type: 'SUSPENSION', status: 'APPROVED', endDate: { lt: day } },
    include: { student: { select: { id: true, fullName: true, status: true } } },
  });
  for (const a of ending) {
    await tx.disciplineAction.update({ where: { id: a.id }, data: { status: 'ENDED' } });
    // Only a student who is still suspended goes back to Active; one who has since left stays as they are.
    if (a.student.status === 'SUSPENDED') {
      await tx.student.update({ where: { id: a.studentId }, data: { status: 'ACTIVE' } });
      await logAudit(
        {
          schoolId, actorId: a.approvedById ?? a.requestedById, action: 'END_SUSPENSION', entityType: 'Student', entityId: a.studentId,
          detail: `${a.student.fullName}: suspension ended automatically on ${a.endDate!.toISOString().slice(0, 10)}`,
          before: { status: 'SUSPENDED' }, after: { status: 'ACTIVE', actionId: a.id },
        },
        tx,
      );
    }
  }
  return ending.length;
}

/** Starts and ends whatever is due for one school. Called by the schedule and whenever a student page loads. */
export async function syncSuspensions(schoolId: string, actorId: string, today = todayInHarare()) {
  return getScopedDb(schoolId, actorId).$tx(async (tx) => ({
    ended: await endDueSuspensions(tx, schoolId, today),
    started: await startDueSuspensions(tx, schoolId, today),
  }));
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function studentDiscipline(user: AccessUser, studentId: string) {
  const db = getScopedDb(user.schoolId, user.id);
  const open = await db.academicTerm.findFirst({ where: { status: 'OPEN' }, select: { id: true } });
  const s = await db.student.findFirst({ where: { AND: [studentScope(user, open?.id), { id: studentId }] }, select: { id: true } });
  if (!s) throw new ServiceError('Student not found', 404);
  const rows = await db.incidentStudent.findMany({
    where: { studentId },
    orderBy: { incident: { occurredAt: 'desc' } },
    select: {
      incident: {
        select: {
          id: true, occurredAt: true, location: true, category: true, severity: true, description: true, witnesses: true, recordedById: true,
          actions: { where: { studentId }, orderBy: { createdAt: 'asc' } },
          students: { select: { student: { select: { id: true, fullName: true } } } },
        },
      },
    },
  });
  const recorders = await db.user.findMany({ where: { id: { in: rows.map((r) => r.incident.recordedById) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(recorders.map((u) => [u.id, u.fullName]));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return rows.map(({ incident: i }) => ({
    id: i.id, occurredAt: i.occurredAt.toISOString(), location: i.location, category: i.category, severity: i.severity,
    description: i.description, witnesses: i.witnesses, recordedBy: nameOf.get(i.recordedById) ?? '—',
    alsoInvolved: i.students.filter((x) => x.student.id !== studentId).map((x) => x.student.fullName),
    actions: i.actions.map((a) => ({
      id: a.id, type: a.type, status: a.status, startDate: day(a.startDate), endDate: day(a.endDate), notes: a.notes,
      decision: a.decision, decisionDate: day(a.decisionDate), authorityRef: a.authorityRef,
      meeting: a.meetingDate ? { date: day(a.meetingDate), attendees: a.meetingAttendees, outcome: a.meetingOutcome, hasLetter: !!a.meetingLetterKey } : null,
    })),
  }));
}

export interface DisciplineReport {
  byCategory: { category: IncidentCategory; count: number }[];
  byClass: { className: string; count: number }[];
  byMonth: { month: string; count: number }[];
  repeaters: { studentId: string; fullName: string; className: string | null; count: number }[];
  openSuspensions: { actionId: string; studentId: string; fullName: string; startDate: string; endDate: string; status: string }[];
}

/** Incidents by category, class and month; students with 3 or more incidents in the term; open suspensions. */
export async function disciplineReport(user: AccessUser, termId?: string): Promise<DisciplineReport> {
  const db = getScopedDb(user.schoolId, user.id);
  const term = termId
    ? await db.academicTerm.findFirst({ where: { id: termId } })
    : await db.academicTerm.findFirst({ where: { status: 'OPEN' } });
  if (!term) return { byCategory: [], byClass: [], byMonth: [], repeaters: [], openSuspensions: [] };
  const scope = studentScope(user, term.status === 'OPEN' ? term.id : null);
  const rows = await db.incidentStudent.findMany({
    where: {
      student: scope,
      incident: { occurredAt: { gte: term.startDate, lt: new Date(term.endDate.getTime() + 86_400_000) } },
    },
    select: { studentId: true, student: { select: { fullName: true, currentClass: { select: { name: true } } } }, incident: { select: { category: true, occurredAt: true } } },
  });
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return Array.from(m, ([k, n]) => [k, n] as const).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  const perStudent = new Map<string, { fullName: string; className: string | null; count: number }>();
  for (const r of rows) {
    const e = perStudent.get(r.studentId) ?? { fullName: r.student.fullName, className: r.student.currentClass?.name ?? null, count: 0 };
    e.count++;
    perStudent.set(r.studentId, e);
  }
  const suspensions = await db.disciplineAction.findMany({
    where: { type: 'SUSPENSION', status: { in: ['PENDING', 'APPROVED'] }, student: scope },
    orderBy: { startDate: 'asc' },
    include: { student: { select: { fullName: true } } },
  });
  return {
    byCategory: count(rows.map((r) => r.incident.category)).map(([category, n]) => ({ category, count: n })),
    byClass: count(rows.map((r) => r.student.currentClass?.name ?? 'No class')).map(([className, n]) => ({ className, count: n })),
    byMonth: count(rows.map((r) => r.incident.occurredAt.toISOString().slice(0, 7))).map(([month, n]) => ({ month, count: n })).sort((a, b) => a.month.localeCompare(b.month)),
    repeaters: Array.from(perStudent, ([studentId, e]) => ({ studentId, ...e })).filter((e) => e.count >= 3).sort((a, b) => b.count - a.count || a.fullName.localeCompare(b.fullName)),
    openSuspensions: suspensions.map((a) => ({
      actionId: a.id, studentId: a.studentId, fullName: a.student.fullName, status: a.status,
      startDate: a.startDate!.toISOString().slice(0, 10), endDate: a.endDate!.toISOString().slice(0, 10),
    })),
  };
}


/** Suspensions and expulsion recommendations waiting for the Head, oldest first. */
export async function pendingDecisions(user: AccessUser) {
  if (!can(user, 'students.discipline.approve')) throw new ServiceError('Forbidden', 403);
  const db = getScopedDb(user.schoolId, user.id);
  const rows = await db.disciplineAction.findMany({
    where: { status: 'PENDING', type: { in: ['SUSPENSION', 'EXPULSION_RECOMMENDED'] } },
    orderBy: { createdAt: 'asc' },
    include: {
      student: { select: { id: true, fullName: true, currentClass: { select: { name: true } } } },
      incident: { select: { category: true, severity: true, occurredAt: true, description: true } },
    },
  });
  const people = await db.user.findMany({ where: { id: { in: rows.map((r) => r.requestedById) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return rows.map((a) => ({
    id: a.id, type: a.type, studentId: a.student.id, studentName: a.student.fullName, className: a.student.currentClass?.name ?? null,
    startDate: iso(a.startDate), endDate: iso(a.endDate), notes: a.notes, category: a.incident.category, severity: a.incident.severity,
    occurredAt: a.incident.occurredAt.toISOString(), description: a.incident.description, requestedBy: nameOf.get(a.requestedById) ?? '—', requestedAt: a.createdAt.toISOString(),
  }));
}
