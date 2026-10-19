// The student profile: a header that is always visible, and one loader per tab so each role gets only what it may see.
//   header      students.profiles.view     (with the alert strip)
//   overview    students.profiles.view
//   guardians   students.guardians.view    (ID numbers only with students.guardians.view_ids)
//   enrolment   students.enrolment.view
//   activity    system.audit.view
// Documents, Discipline and Medical have their own services (documents.ts, discipline.ts, medical.ts).
// Every loader checks that the student is in the user's school and is one the user may reach.
import type { Prisma } from '@prisma/client';
import { ServiceError } from '@/lib/api';
import { can, type AccessUser } from '@/lib/access-core';
import { getScopedDb, type Db } from '@/lib/scoped-db';
import { medicalAlerts } from '@/lib/students/medical';
import { ageOn, todayInHarare } from '@/lib/students/registration';
import { buildAlerts, formatBirthCert, studentAccess, type Alert } from '@/lib/students/rules';
import { studentScope } from '@/lib/students/scope';
import { CLASS_MOVE_REASON_LABEL } from '@/lib/students/enrolment';

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function reachable(db: Db, user: AccessUser, studentId: string) {
  const open = await db.academicTerm.findFirst({ where: { schoolId: user.schoolId, status: 'OPEN' }, select: { id: true, name: true, startDate: true } });
  const student = await db.student.findFirst({ where: { AND: [studentScope(user, open?.id), { id: studentId }] }, select: { id: true } });
  if (!student) throw new ServiceError('Student not found', 404);
  return open;
}

// ─── Header ──────────────────────────────────────────────────────────────────

export interface ProfileHeader {
  id: string;
  fullName: string;
  preferredName: string | null;
  photoUrl: string | null;
  admissionNumber: string;
  className: string | null;
  classId: string | null;
  status: string;
  boarding: 'DAY' | 'BOARDER';
  houseName: string | null;
  age: number | null;
  alerts: Alert[];
  /** What the buttons in the header may do for this user right now. */
  actions: { edit: boolean; moveClass: boolean; recordIncident: boolean; print: boolean; startLeaving: boolean; regenerateAdmissionLetter: boolean; rejoin: boolean };
}

export async function profileHeader(user: AccessUser, studentId: string): Promise<ProfileHeader> {
  const db = getScopedDb(user.schoolId, user.id);
  const open = await reachable(db, user, studentId);
  const access = studentAccess(user);
  const s = await db.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      id: true, fullName: true, preferredName: true, photoUrl: true, admissionNumber: true, status: true, boarding: true, dateOfBirth: true, specialNeeds: true,
      currentClass: { select: { id: true, name: true } }, house: { select: { name: true } },
      guardians: { where: { custodyNote: { not: null } }, select: { custodyNote: true } },
    },
  });
  const [severe, suspension, medical] = await Promise.all([
    medicalAlerts(db, [s.id]),
    s.status === 'SUSPENDED'
      ? db.disciplineAction.findFirst({ where: { studentId: s.id, type: 'SUSPENSION', status: 'APPROVED' }, orderBy: { endDate: 'desc' }, select: { endDate: true } })
      : Promise.resolve(null),
    // Only a user who may see medical details is told which allergy it is.
    access.medical ? db.medicalProfile.findUnique({ where: { studentId: s.id }, select: { allergies: true } }) : Promise.resolve(null),
  ]);
  const severeNames = access.medical
    ? ((medical?.allergies as { name: string; severity: string }[] | undefined) ?? []).filter((a) => a.severity === 'SEVERE').map((a) => a.name)
    : [];
  const alerts = buildAlerts(
    {
      hasMedicalAlert: severe.has(s.id), severeAllergies: severeNames,
      suspension: suspension?.endDate ? { endDate: day(suspension.endDate)! } : s.status === 'SUSPENDED' ? { endDate: 'further notice' } : null,
      specialNeeds: s.specialNeeds,
      custodyNotes: s.guardians.flatMap((g) => (g.custodyNote ? [g.custodyNote] : [])),
    },
    { canSeeMedical: access.medical },
  );
  const atSchool = s.status === 'ACTIVE' || s.status === 'SUSPENDED';
  return {
    id: s.id, fullName: s.fullName, preferredName: s.preferredName, photoUrl: s.photoUrl, admissionNumber: s.admissionNumber,
    className: s.currentClass?.name ?? null, classId: s.currentClass?.id ?? null, status: s.status, boarding: s.boarding, houseName: s.house?.name ?? null,
    age: s.dateOfBirth ? ageOn(day(s.dateOfBirth)!, todayInHarare()) : null, alerts,
    actions: {
      edit: access.edit, moveClass: access.manageEnrolment && atSchool && !!open, recordIncident: access.recordIncident && atSchool,
      print: access.profile, startLeaving: access.startLeaving && atSchool, regenerateAdmissionLetter: access.generateDocuments && atSchool,
      rejoin: access.create && ['TRANSFERRED', 'WITHDRAWN', 'GRADUATED'].includes(s.status),
    },
  };
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface ProfileOverview {
  firstName: string;
  surname: string;
  preferredName: string | null;
  gender: 'M' | 'F' | null;
  dateOfBirth: string | null;
  age: number | null;
  /** Shown in the usual layout only to a user who may see ID numbers. */
  birthCertificateNumber: string | null;
  hasBirthCertificate: boolean;
  nationality: string | null;
  homeLanguage: string | null;
  religion: string | null;
  address: string | null;
  admissionDate: string;
  entryType: string | null;
  previousSchool: string | null;
  entryResults: unknown;
  isBeam: boolean;
  sponsorName: string | null;
  orphanStatus: string;
  specialNeeds: boolean;
  /** Only for a user who may see medical details. */
  specialNeedsNote: string | null;
  primaryGuardian: { fullName: string; phone: string } | null;
  siblings: { id: string; fullName: string; className: string | null; status: string }[];
  /** Exam candidate numbers and released board grades (Examinations), for a user who may see results. */
  examinations: { candidateNumbers: { session: string; number: string }[]; boardResults: { board: string; session: string; results: { code: string; subject: string; grade: string }[] }[] } | null;
}

export async function profileOverview(user: AccessUser, studentId: string): Promise<ProfileOverview> {
  const db = getScopedDb(user.schoolId, user.id);
  await reachable(db, user, studentId);
  const access = studentAccess(user);
  const s = await db.student.findUniqueOrThrow({
    where: { id: studentId },
    include: { guardians: { include: { guardian: { select: { id: true, fullName: true, phone: true } } } } },
  });
  // Siblings are the other students at the school who share a guardian with this one.
  const sharedGuardianIds = s.guardians.map((g) => g.guardianId);
  const siblings = sharedGuardianIds.length
    ? await db.student.findMany({
        where: { AND: [studentScope(user), { id: { not: s.id } }, { guardians: { some: { guardianId: { in: sharedGuardianIds } } } }] },
        select: { id: true, fullName: true, status: true, currentClass: { select: { name: true } } },
        orderBy: { fullName: 'asc' },
      })
    : [];
  const primary = access.guardians ? s.guardians.find((g) => g.isPrimary)?.guardian ?? null : null;
  let examinations: ProfileOverview['examinations'] = null;
  if (can(user, 'exams.results.view') || can(user, 'exams.zimsec.manage')) {
    const [cands, board] = await Promise.all([
      db.candidate.findMany({ where: { studentId, candidateNumber: { not: null } }, select: { candidateNumber: true, session: { select: { board: true, session: true } } }, orderBy: { createdAt: 'desc' } }),
      db.boardResult.findMany({ where: { studentId }, include: { code: { select: { code: true, name: true } }, session: { select: { board: true, session: true } } }, orderBy: [{ session: { createdAt: 'desc' } }, { code: { code: 'asc' } }] }),
    ]);
    const groups = new Map<string, NonNullable<ProfileOverview['examinations']>['boardResults'][number]>();
    for (const r of board) (groups.get(r.sessionId) ?? groups.set(r.sessionId, { board: r.session.board, session: r.session.session, results: [] }).get(r.sessionId)!).results.push({ code: r.code.code, subject: r.code.name, grade: r.grade });
    if (cands.length || board.length) examinations = { candidateNumbers: cands.map((c) => ({ session: `${c.session.board} ${c.session.session}`, number: c.candidateNumber! })), boardResults: Array.from(groups.values()) };
  }
  return {
    firstName: s.firstName, surname: s.surname, preferredName: s.preferredName, gender: s.gender, dateOfBirth: day(s.dateOfBirth),
    age: s.dateOfBirth ? ageOn(day(s.dateOfBirth)!, todayInHarare()) : null,
    birthCertificateNumber: access.idNumbers && s.birthCertificateNumber ? formatBirthCert(s.birthCertificateNumber) : null,
    hasBirthCertificate: !!s.birthCertificateNumber,
    nationality: s.nationality, homeLanguage: s.homeLanguage, religion: s.religion, address: s.address,
    admissionDate: day(s.admissionDate)!, entryType: s.entryType, previousSchool: s.previousSchool, entryResults: s.entryResults,
    isBeam: s.isBeam, sponsorName: s.sponsorName, orphanStatus: s.orphanStatus, specialNeeds: s.specialNeeds,
    specialNeedsNote: access.medical ? s.specialNeedsNote : null,
    primaryGuardian: primary ? { fullName: primary.fullName, phone: primary.phone } : null,
    siblings: siblings.map((x) => ({ id: x.id, fullName: x.fullName, className: x.currentClass?.name ?? null, status: x.status })),
    examinations,
  };
}

// ─── Guardians ───────────────────────────────────────────────────────────────

export interface ProfileGuardian {
  guardianId: string;
  fullName: string;
  relationship: string;
  relationshipNote: string | null;
  phone: string;
  altPhone: string | null;
  email: string | null;
  /** The ID number itself only for a user who may see ID numbers; everyone else learns only that one is on file. */
  nationalId: string | null;
  hasNationalId: boolean;
  occupation: string | null;
  address: string | null;
  isPrimary: boolean;
  isFeePayer: boolean;
  receivesSms: boolean;
  canCollect: boolean;
  custodyNote: string | null;
  /** Other children of this guardian at the school. */
  otherChildren: { id: string; fullName: string; className: string | null }[];
}

export async function profileGuardians(user: AccessUser, studentId: string): Promise<ProfileGuardian[]> {
  const db = getScopedDb(user.schoolId, user.id);
  await reachable(db, user, studentId);
  const access = studentAccess(user);
  const links = await db.studentGuardian.findMany({
    where: { studentId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: {
      guardian: {
        include: { students: { where: { studentId: { not: studentId }, student: { status: { in: ['ACTIVE', 'SUSPENDED'] } } }, select: { student: { select: { id: true, fullName: true, currentClass: { select: { name: true } } } } } } },
      },
    },
  });
  return links.map((l) => ({
    guardianId: l.guardianId, fullName: l.guardian.fullName, relationship: l.relationship, relationshipNote: l.relationshipNote, phone: l.guardian.phone,
    altPhone: l.guardian.altPhone, email: l.guardian.email, nationalId: access.idNumbers ? l.guardian.nationalId : null, hasNationalId: !!l.guardian.nationalId,
    occupation: l.guardian.occupation, address: l.guardian.address, isPrimary: l.isPrimary, isFeePayer: l.isFeePayer, receivesSms: l.canReceiveSms,
    canCollect: l.canCollect, custodyNote: l.custodyNote,
    otherChildren: l.guardian.students.map((x) => ({ id: x.student.id, fullName: x.student.fullName, className: x.student.currentClass?.name ?? null })),
  }));
}

// ─── Enrolment ───────────────────────────────────────────────────────────────

export interface ProfileEnrolment {
  admission: { admissionNumber: string; admissionDate: string; entryType: string | null; previousSchool: string | null };
  history: { termId: string; term: string; className: string; status: string; startDate: string; endDate: string | null; reason: string | null }[];
  moves: { id: string; from: string | null; to: string; effectiveDate: string; reason: string; reasonNote: string | null; status: string; requestedBy: string; approvedBy: string | null }[];
}

export async function profileEnrolment(user: AccessUser, studentId: string): Promise<ProfileEnrolment> {
  const db = getScopedDb(user.schoolId, user.id);
  await reachable(db, user, studentId);
  const [s, enrollments, moves] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: studentId }, select: { admissionNumber: true, admissionDate: true, entryType: true, previousSchool: true } }),
    db.enrollment.findMany({ where: { studentId }, orderBy: { term: { startDate: 'desc' } }, include: { term: { select: { id: true, name: true } }, class: { select: { name: true } } } }),
    db.classMove.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, include: { from: { select: { name: true } }, to: { select: { name: true } } } }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: moves.flatMap((m) => [m.requestedById, ...(m.approvedById ? [m.approvedById] : [])]) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));
  return {
    admission: { admissionNumber: s.admissionNumber, admissionDate: day(s.admissionDate)!, entryType: s.entryType, previousSchool: s.previousSchool },
    history: enrollments.map((e) => ({ termId: e.term.id, term: e.term.name, className: e.class.name, status: e.status, startDate: day(e.startDate)!, endDate: day(e.endDate), reason: e.reason })),
    moves: moves.map((m) => ({
      id: m.id, from: m.from?.name ?? null, to: m.to.name, effectiveDate: day(m.effectiveDate)!, reason: CLASS_MOVE_REASON_LABEL[m.reason], reasonNote: m.reasonNote, status: m.status,
      requestedBy: nameOf.get(m.requestedById) ?? '—', approvedBy: m.approvedById ? nameOf.get(m.approvedById) ?? '—' : null,
    })),
  };
}

// ─── Activity ────────────────────────────────────────────────────────────────

export interface ActivityEntry { id: string; at: string; actor: string; action: string; detail: string | null; entityType: string }

const MEDICAL_ACTIONS = ['MEDICAL_VIEWED', 'UPDATE_MEDICAL'] as const;

/** This student's audit log: entries about the student and about rows that belong to them. Newest first. */
export async function profileActivity(user: AccessUser, studentId: string, page = 1): Promise<{ total: number; entries: ActivityEntry[] }> {
  const db = getScopedDb(user.schoolId, user.id);
  await reachable(db, user, studentId);
  const access = studentAccess(user);
  const about: Prisma.AuditLogWhereInput[] = [
    { entityType: 'Student', entityId: studentId },
    { after: { path: ['studentId'], equals: studentId } },
    { before: { path: ['studentId'], equals: studentId } },
  ];
  const where: Prisma.AuditLogWhereInput = { AND: [{ OR: about }, ...(access.medical ? [] : [{ action: { notIn: [...MEDICAL_ACTIONS] } }])] };
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (Math.max(page, 1) - 1) * 50, take: 50, include: { actor: { select: { fullName: true } } } }),
  ]);
  return { total, entries: rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.actor.fullName, action: r.action, detail: r.detail, entityType: r.entityType })) };
}
