import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import { csvRowToInput, mapHeaders, parseCsv } from '@/lib/students/csv';
import {
  ageWarning,
  RegisterStudentSchema,
  type RegisterStudentData,
} from '@/lib/students/registration';
import {
  activeStudentCount,
  classFullMessage,
  dobToDate,
  duplicateMessage,
  findClass,
  findOrCreateClass,
  getMaxClassSize,
  nextSequences,
  StudentNumberExhaustedError,
  studentRecord,
  takeStudentNumber,
  withStudentNumberRetry,
} from '@/lib/students/server';
import type { SessionUser } from '@/types';

const MAX_ROWS = 1000;

interface RowReport {
  row: number;      // spreadsheet row number (header is row 1)
  name: string;
  messages: string[];
  studentNumber?: string;
}

// Rules are the same as the Register Student form. Hard errors and likely
// duplicates are skipped; soft warnings (age, class size) are imported and
// listed so the admin can follow up.
async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageStudents(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const rows = parseCsv(await req.text());
  if (rows.length < 2) return apiError('The CSV must have a header row and at least one student row', 422);
  if (rows.length - 1 > MAX_ROWS) {
    return apiError(`The CSV has ${rows.length - 1} students. Please split it into files of ${MAX_ROWS} or fewer.`, 422);
  }

  const { index, missing } = mapHeaders(rows[0]);
  if (missing.length > 0) {
    return apiError(`Missing required column(s): ${missing.join(', ')}. Download the template to see the expected columns.`, 422);
  }

  const failed: RowReport[] = [];
  const warnings: RowReport[] = [];
  const valid: { row: number; data: RegisterStudentData; warnings: string[] }[] = [];
  const seenInFile = new Map<string, number>();

  // 1. Field validation — identical to the form.
  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const input = csvRowToInput(rows[i], index);
    const name = `${input.firstName} ${input.surname}`.trim() || '(no name)';
    const parsed = RegisterStudentSchema.safeParse(input);
    if (!parsed.success) {
      failed.push({ row: rowNumber, name, messages: Array.from(new Set(parsed.error.issues.map((x) => x.message))) });
      continue;
    }
    const data = parsed.data;
    const key = `${data.firstName.toLowerCase()}|${data.surname.toLowerCase()}|${data.dateOfBirth}`;
    const earlier = seenInFile.get(key);
    if (earlier) {
      failed.push({ row: rowNumber, name: data.fullName, messages: [`Same name and date of birth as row ${earlier} in this file`] });
      continue;
    }
    seenInFile.set(key, rowNumber);
    const age = ageWarning(data.dateOfBirth, data.form);
    valid.push({ row: rowNumber, data, warnings: age ? [age] : [] });
  }

  // 2. Duplicates already in the database.
  const dobs = Array.from(new Set(valid.map((v) => v.data.dateOfBirth))).map(dobToDate);
  const existing = dobs.length === 0 ? [] : await prisma.student.findMany({
    where: { schoolId: user.schoolId, dateOfBirth: { in: dobs } },
    select: { firstName: true, surname: true, dateOfBirth: true, studentNumber: true, fullName: true, class: { select: { name: true } } },
  });
  const existingByKey = new Map(existing.map((s) => [
    `${(s.firstName ?? '').toLowerCase()}|${(s.surname ?? '').toLowerCase()}|${s.dateOfBirth?.toISOString().slice(0, 10)}`,
    s,
  ]));
  const toImport = valid.filter((v) => {
    const dup = existingByKey.get(`${v.data.firstName.toLowerCase()}|${v.data.surname.toLowerCase()}|${v.data.dateOfBirth}`);
    if (!dup) return true;
    failed.push({
      row: v.row,
      name: v.data.fullName,
      messages: [`${duplicateMessage(dup)} Not imported — if this really is a different child, register them with the form.`],
    });
    return false;
  });

  // 3. Class size — counted cumulatively across the file.
  const maxClassSize = await getMaxClassSize(user.schoolId);
  const classCounts = new Map<string, { name: string; count: number }>();
  for (const v of toImport) {
    const key = `${v.data.form}|${v.data.stream}`;
    if (!classCounts.has(key)) {
      const schoolClass = await findClass(user.schoolId, v.data.form, v.data.stream);
      classCounts.set(key, { name: schoolClass?.name ?? v.data.className, count: await activeStudentCount(schoolClass?.id) });
    }
    if (v.data.status !== 'ACTIVE') continue;
    const c = classCounts.get(key)!;
    if (c.count + 1 > maxClassSize) v.warnings.push(classFullMessage(c.name, c.count, maxClassSize));
    c.count += 1;
  }

  // 4. Save all remaining rows together.
  let numbers = new Map<number, string>();
  if (toImport.length > 0) {
    try {
      numbers = await withStudentNumberRetry(() =>
        prisma.$transaction(async (tx) => {
          const classIds = new Map<string, string>();
          for (const v of toImport) {
            const key = `${v.data.form}|${v.data.stream}`;
            if (!classIds.has(key)) {
              const c = await findOrCreateClass(tx, user.schoolId, user.id, v.data.form, v.data.stream);
              classIds.set(key, c.id);
            }
          }
          const sequences = await nextSequences(tx, user.schoolId, toImport.map((v) => v.data.enrollmentYear));
          const assigned = new Map<number, string>();
          const records = toImport.map((v) => {
            const studentNumber = takeStudentNumber(sequences, v.data.enrollmentYear);
            assigned.set(v.row, studentNumber);
            return studentRecord(user.schoolId, classIds.get(`${v.data.form}|${v.data.stream}`)!, studentNumber, v.data);
          });
          await tx.student.createMany({ data: records });
          await logAudit(
            {
              schoolId:   user.schoolId,
              actorId:    user.id,
              action:     'CREATE_STUDENT',
              entityType: 'Student',
              entityId:   'bulk-import',
              detail:     `Imported ${records.length} student(s) from CSV (${failed.length} row(s) skipped)`,
            },
            tx,
          );
          return assigned;
        }, { timeout: 30_000 }),
      );
    } catch (e) {
      if (e instanceof StudentNumberExhaustedError) return apiError(e.message, 409);
      throw e;
    }
  }

  for (const v of toImport) {
    if (v.warnings.length > 0) {
      warnings.push({ row: v.row, name: v.data.fullName, studentNumber: numbers.get(v.row), messages: v.warnings });
    }
  }
  failed.sort((a, b) => a.row - b.row);

  return apiSuccess({
    totalRows: rows.length - 1,
    imported:  toImport.length,
    failed,
    warnings,
  });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/import', _POST as H);
