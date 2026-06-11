import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiSuccess, apiUnauthorized, apiError, withApi } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { canManageStudents } from '@/lib/permissions';
import type { SessionUser } from '@/types';

// Parses a single CSV line, handling double-quoted fields that may contain commas.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { current += char; }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

const REQUIRED_HEADERS = ['fullName', 'parentName', 'parentPhone', 'class'];

async function _POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiUnauthorized();
  const user = session.user as unknown as SessionUser;

  try { await canManageStudents(user.role); } catch (e) { if (e instanceof Response) return e; throw e; }

  const text = await req.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return apiError('CSV must contain a header row and at least one data row', 422);

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) return apiError(`Missing required column(s): ${missing.join(', ')}`, 422);

  const idx = {
    fullName:    headers.indexOf('fullName'),
    parentName:  headers.indexOf('parentName'),
    parentPhone: headers.indexOf('parentPhone'),
    class:       headers.indexOf('class'),
  };

  const classes = await prisma.schoolClass.findMany({ where: { schoolId: user.schoolId } });
  const classByName = new Map(classes.map((c) => [c.name, c]));

  const rows: { fullName: string; parentName: string; parentPhone: string; className: string }[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const fullName    = fields[idx.fullName]    ?? '';
    const parentName  = fields[idx.parentName]  ?? '';
    const parentPhone = fields[idx.parentPhone] ?? '';
    const className   = fields[idx.class]       ?? '';

    if (!fullName || !parentName || !parentPhone || !className) {
      errors.push(`Row ${i + 1}: missing required field(s)`);
      continue;
    }
    if (!classByName.has(className)) {
      errors.push(`Row ${i + 1}: unknown class "${className}"`);
      continue;
    }
    rows.push({ fullName, parentName, parentPhone, className });
  }

  if (rows.length === 0) {
    return apiError(`No valid rows to import. ${errors.join('; ')}`, 422);
  }

  const created = await prisma.$transaction(async (tx) => {
    const students = [];
    for (const row of rows) {
      const schoolClass = classByName.get(row.className)!;
      const s = await tx.student.create({
        data: {
          schoolId: user.schoolId,
          fullName: row.fullName,
          grade: schoolClass.grade,
          classId: schoolClass.id,
          parentName: row.parentName,
          parentPhone: row.parentPhone,
          portalToken: crypto.randomUUID(),
        },
      });
      students.push(s);
    }
    await logAudit(
      {
        schoolId:   user.schoolId,
        actorId:    user.id,
        action:     'CREATE_STUDENT',
        entityType: 'Student',
        entityId:   'bulk-import',
        detail:     `Imported ${students.length} student(s) from CSV`,
      },
      tx,
    );
    return students;
  });

  return apiSuccess({ imported: created.length, skipped: errors.length, errors });
}

type H = (req: Request, ctx?: unknown) => Promise<Response>;
export const POST = withApi('POST /api/admin/students/import', _POST as H);
