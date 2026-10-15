import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { getScopedDb } from '@/lib/scoped-db';
import { apiSuccess, apiUnauthorized, apiError, withApi } from '@/lib/api';
import { canManageEnrollment } from '@/lib/permissions';
import { dateOnly, requireOpenTerm } from '@/lib/academic/terms';
import { csvRowToInput, mapHeaders, parseCsv, type RejectedRow } from '@/lib/students/csv';
import { ageWarning, ImportStudentRowSchema, type AdmissionData } from '@/lib/students/registration';
import {
  classFullMessage,
  classOccupancy,
  dobToDate,
  duplicateMessage,
  findClass,
  findOrCreateClass,
  nextSequences,
  takeAdmissionNumber,
  withAdmissionNumberRetry,
} from '@/lib/students/server';
import type { SessionUser } from '@/types';

const MAX_ROWS = 500;

interface WarningRow extends RejectedRow {
  admissionNumber?: string;
}

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase();

// Same rules as the Register Student form. Rows that break a rule, look like a
// duplicate, or reuse an admission/birth certificate number are rejected with
// reasons; all valid rows are admitted together in one transaction. Soft
// warnings (age, class capacity) are imported and listed for follow-up.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;
  const db = getScopedDb(user.schoolId, user.id);
  const { schoolId } = user;

  try { await canManageEnrollment(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const term = await requireOpenTerm(schoolId, db);

  const rows = parseCsv(await req.text());
  if (rows.length < 2) return apiError('The CSV must have a header row and at least one student row', 422);
  if (rows.length - 1 > MAX_ROWS) {
    return apiError(`The CSV has ${rows.length - 1} students. Please split it into files of ${MAX_ROWS} or fewer.`, 422);
  }
  const { index, missing } = mapHeaders(rows[0]);
  if (missing.length > 0) {
    return apiError(`Missing required column(s): ${missing.join(', ')}. Download the template to see the expected columns.`, 422);
  }

  const rejected: RejectedRow[] = [];
  const valid: { row: number; data: AdmissionData; warnings: string[] }[] = [];
  const seen = { student: new Map<string, number>(), admission: new Map<string, number>(), birthCert: new Map<string, number>() };

  // 1. Field rules + duplicates within the file.
  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const input = csvRowToInput(rows[i], index);
    const name = `${input.firstName} ${input.surname}`.trim() || '(no name)';
    const parsed = ImportStudentRowSchema.safeParse(input);
    if (!parsed.success) {
      rejected.push({ row: rowNumber, name, messages: Array.from(new Set(parsed.error.issues.map((x) => x.message))) });
      continue;
    }
    const d = parsed.data;
    const problems: string[] = [];
    const key = `${lower(d.firstName)}|${lower(d.surname)}|${d.dateOfBirth}`;
    if (seen.student.has(key)) problems.push(`Same name and date of birth as row ${seen.student.get(key)} in this file`);
    if (d.admissionNumber && seen.admission.has(d.admissionNumber)) problems.push(`Admission number ${d.admissionNumber} is also used on row ${seen.admission.get(d.admissionNumber)}`);
    if (d.birthCertificateNumber && seen.birthCert.has(d.birthCertificateNumber)) problems.push(`Birth certificate number is also used on row ${seen.birthCert.get(d.birthCertificateNumber)}`);
    if (problems.length) { rejected.push({ row: rowNumber, name: d.fullName, messages: problems }); continue; }
    seen.student.set(key, rowNumber);
    if (d.admissionNumber) seen.admission.set(d.admissionNumber, rowNumber);
    if (d.birthCertificateNumber) seen.birthCert.set(d.birthCertificateNumber, rowNumber);
    const age = ageWarning(d.dateOfBirth, d.level);
    valid.push({ row: rowNumber, data: d, warnings: age ? [age] : [] });
  }

  // 2. Conflicts with students already in the school.
  const [existingByDob, existingNumbers, existingCerts] = await Promise.all([
    valid.length ? db.student.findMany({
      where: { schoolId, dateOfBirth: { in: Array.from(new Set(valid.map((v) => v.data.dateOfBirth))).map(dobToDate) } },
      select: { firstName: true, surname: true, dateOfBirth: true, admissionNumber: true, fullName: true, currentClass: { select: { name: true } } },
    }) : [],
    db.student.findMany({
      where: { schoolId, admissionNumber: { in: valid.flatMap((v) => (v.data.admissionNumber ? [v.data.admissionNumber] : [])) } },
      select: { admissionNumber: true, fullName: true },
    }),
    db.student.findMany({
      where: { schoolId, birthCertificateNumber: { in: valid.flatMap((v) => (v.data.birthCertificateNumber ? [v.data.birthCertificateNumber] : [])) } },
      select: { birthCertificateNumber: true, fullName: true },
    }),
  ]);
  const dupByKey = new Map(existingByDob.map((s) => [`${lower(s.firstName)}|${lower(s.surname)}|${s.dateOfBirth?.toISOString().slice(0, 10)}`, s]));
  const numberOwner = new Map(existingNumbers.map((s) => [s.admissionNumber, s.fullName]));
  const certOwner = new Map(existingCerts.map((s) => [s.birthCertificateNumber, s.fullName]));

  const toImport = valid.filter((v) => {
    const problems: string[] = [];
    const dup = dupByKey.get(`${lower(v.data.firstName)}|${lower(v.data.surname)}|${v.data.dateOfBirth}`);
    if (dup) problems.push(`${duplicateMessage(dup)} Not imported — if this really is a different child, register them with the form.`);
    if (v.data.admissionNumber && numberOwner.has(v.data.admissionNumber)) problems.push(`Admission number ${v.data.admissionNumber} already belongs to ${numberOwner.get(v.data.admissionNumber)}`);
    if (v.data.birthCertificateNumber && certOwner.has(v.data.birthCertificateNumber)) problems.push(`Birth certificate number already belongs to ${certOwner.get(v.data.birthCertificateNumber)}`);
    if (problems.length) { rejected.push({ row: v.row, name: v.data.fullName, messages: problems }); return false; }
    return true;
  });

  // 3. Class capacity, counted cumulatively across the file.
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { maxClassSize: true } });
  const occupancy = new Map<string, { name: string; count: number; capacity: number }>();
  for (const v of toImport) {
    const key = `${v.data.level}|${lower(v.data.stream)}`;
    if (!occupancy.has(key)) {
      const c = await findClass(schoolId, v.data.level, v.data.stream, db);
      occupancy.set(key, { name: c?.name ?? v.data.className, count: await classOccupancy(c?.id, term.id, db), capacity: c?.capacity ?? school?.maxClassSize ?? 45 });
    }
    const o = occupancy.get(key)!;
    if (o.count + 1 > o.capacity) v.warnings.push(classFullMessage(o.name, o.count, o.capacity));
    o.count += 1;
  }

  // 4. Admit every remaining row in one transaction.
  let numbers = new Map<number, string>();
  if (toImport.length > 0) {
    numbers = await withAdmissionNumberRetry(() => db.$tx(async (tx) => {
      const classIds = new Map<string, string>();
      for (const v of toImport) {
        const key = `${v.data.level}|${lower(v.data.stream)}`;
        if (!classIds.has(key)) classIds.set(key, (await findOrCreateClass(tx, schoolId, user.id, v.data.level, v.data.stream)).id);
      }

      // Admission numbers: supplied ones are kept; generated ones skip any supplied in this file.
      const supplied = new Set(toImport.flatMap((v) => (v.data.admissionNumber ? [v.data.admissionNumber] : [])));
      const sequences = await nextSequences(tx, schoolId, toImport.map((v) => Number(v.data.admissionDate.slice(0, 4))));
      const assigned = new Map<number, string>();
      for (const v of toImport) {
        assigned.set(v.row, v.data.admissionNumber ?? takeAdmissionNumber(sequences, Number(v.data.admissionDate.slice(0, 4)), supplied));
      }

      // Guardians: siblings share one row (same phone + name), including existing ones.
      const gKey = (g: AdmissionData['guardian']) => `${g.phone}|${lower(g.fullName)}`;
      const existingGuardians = await tx.guardian.findMany({
        where: { schoolId, phone: { in: Array.from(new Set(toImport.map((v) => v.data.guardian.phone))) } },
      });
      const guardianIds = new Map(existingGuardians.map((g) => [`${g.phone}|${lower(g.fullName)}`, g.id]));
      const newGuardians = new Map<string, AdmissionData['guardian']>();
      for (const v of toImport) if (!guardianIds.has(gKey(v.data.guardian))) newGuardians.set(gKey(v.data.guardian), v.data.guardian);
      if (newGuardians.size) {
        const created = await tx.guardian.createManyAndReturn({
          data: Array.from(newGuardians.values()).map((g) => ({ schoolId, ...g })),
          select: { id: true, phone: true, fullName: true },
        });
        for (const g of created) guardianIds.set(`${g.phone}|${lower(g.fullName)}`, g.id);
        await tx.auditLog.createMany({
          data: created.map((g) => ({ schoolId, actorId: user.id, action: 'CREATE_GUARDIAN' as const, entityType: 'Guardian', entityId: g.id, detail: `${g.fullName} ${g.phone} (CSV import)` })),
        });
      }

      const students = await tx.student.createManyAndReturn({
        data: toImport.map((v): Prisma.StudentCreateManyInput => ({
          schoolId,
          admissionNumber:        assigned.get(v.row)!,
          firstName:              v.data.firstName,
          surname:                v.data.surname,
          fullName:               v.data.fullName,
          gender:                 v.data.gender,
          dateOfBirth:            dateOnly(v.data.dateOfBirth),
          birthCertificateNumber: v.data.birthCertificateNumber,
          admissionDate:          dateOnly(v.data.admissionDate),
          previousSchool:         v.data.previousSchool,
          medicalNotes:           v.data.medicalNotes,
          address:                v.data.address,
          status:                 'ACTIVE',
          currentClassId:         classIds.get(`${v.data.level}|${lower(v.data.stream)}`)!,
        })),
        select: { id: true, admissionNumber: true },
      });
      const studentIdByNumber = new Map(students.map((s) => [s.admissionNumber, s.id]));

      await tx.enrollment.createMany({
        data: toImport.map((v) => {
          const admitted = dateOnly(v.data.admissionDate);
          return {
            schoolId,
            studentId: studentIdByNumber.get(assigned.get(v.row)!)!,
            classId: classIds.get(`${v.data.level}|${lower(v.data.stream)}`)!,
            termId: term.id,
            status: 'ACTIVE' as const,
            startDate: admitted > term.startDate ? admitted : term.startDate,
          };
        }),
      });
      await tx.studentGuardian.createMany({
        data: toImport.map((v) => ({
          studentId: studentIdByNumber.get(assigned.get(v.row)!)!,
          guardianId: guardianIds.get(gKey(v.data.guardian))!,
          relationship: v.data.relationship,
          relationshipNote: v.data.relationshipNote,
          isPrimary: true,
          isFeePayer: true,
          canReceiveSms: true,
        })),
      });
      await tx.auditLog.createMany({
        data: toImport.map((v) => ({
          schoolId,
          actorId: user.id,
          action: 'ADMIT_STUDENT' as const,
          entityType: 'Student',
          entityId: studentIdByNumber.get(assigned.get(v.row)!)!,
          detail: `${assigned.get(v.row)} ${v.data.fullName} — ${v.data.className} (CSV import)`,
        })),
      });
      return assigned;
    }, { timeout: 60_000 }));
  }

  const warnings: WarningRow[] = toImport
    .filter((v) => v.warnings.length > 0)
    .map((v) => ({ row: v.row, name: v.data.fullName, admissionNumber: numbers.get(v.row), messages: v.warnings }));
  rejected.sort((a, b) => a.row - b.row);

  return apiSuccess({
    totalRows: rows.length - 1,
    imported: toImport.length,
    termName: term.name,
    rejected,
    warnings,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/import', _POST as H);
