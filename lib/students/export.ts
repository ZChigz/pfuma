// Student exports. The columns a user may take depend on what they may see (rules.ts); medical,
// discipline and ID-number columns are left out otherwise, and every export writes an audit entry
// that records who took which columns for how many students.
import type { Prisma } from '@prisma/client';
import type { AccessUser } from '@/lib/access-core';
import { logAudit } from '@/lib/audit';
import { toCsv, type CsvCell } from '@/lib/csv';
import { getScopedDb } from '@/lib/scoped-db';
import { listWhere, selectedTerm, type StudentListQuery } from '@/lib/students/list';
import { ageOn, todayInHarare } from '@/lib/students/registration';
import { exportColumnsFor, formatBirthCert, STATUS_LABEL, type ExportColumn } from '@/lib/students/rules';

export const MAX_EXPORT_ROWS = 5000;

export interface ExportResult { columns: ExportColumn[]; headers: string[]; rows: CsvCell[][]; csv: string; count: number }

interface Allergy { name: string; severity: 'MILD' | 'SEVERE' }

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/**
 * Builds the export for the students matching `query` (or just `ids`, for the selected rows) and writes
 * the audit entry in the same transaction. `purpose` says where it was taken (list, class list, ...).
 */
export async function exportStudents(
  user: AccessUser,
  query: StudentListQuery,
  opts: { ids?: string[]; columns?: string[]; purpose?: string } = {},
): Promise<ExportResult> {
  const columns = exportColumnsFor(user, opts.columns);
  const keys = new Set(columns.map((c) => c.key));
  const db = getScopedDb(user.schoolId, user.id);

  return db.$tx(async (tx) => {
    const termRow = await selectedTerm(tx, user.schoolId, query.termId);
    const term = termRow ? { id: termRow.id, startDate: termRow.startDate } : null;
    const base = await listWhere({ ...query, q: query.q }, user, term, tx);
    const where: Prisma.StudentWhereInput = opts.ids ? { AND: [base, { id: { in: opts.ids } }] } : base;

    const students = await tx.student.findMany({
      where,
      orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
      take: MAX_EXPORT_ROWS,
      select: {
        id: true, admissionNumber: true, surname: true, firstName: true, gender: true, dateOfBirth: true, status: true, boarding: true,
        admissionDate: true, previousSchool: true, isBeam: true, sponsorName: true, birthCertificateNumber: true, specialNeedsNote: true,
        currentClass: { select: { name: true } },
        house: { select: { name: true } },
        ...(keys.has('guardianName') || keys.has('guardianPhone') || keys.has('guardianNationalId')
          ? { guardians: { where: { isPrimary: true }, take: 1, select: { guardian: { select: { fullName: true, phone: true, nationalId: true } } } } }
          : {}),
        ...(keys.has('medicalAlert') ? { medical: { select: { conditions: true, allergies: true } } } : {}),
        ...(keys.has('incidentCount') ? { _count: { select: { incidents: true } } } : {}),
      },
    });

    const today = todayInHarare();
    const value = (s: (typeof students)[number], key: string): CsvCell => {
      const anyS = s as unknown as {
        guardians?: { guardian: { fullName: string; phone: string; nationalId: string | null } }[];
        medical?: { conditions: unknown; allergies: unknown } | null;
        _count?: { incidents: number };
      };
      const g = anyS.guardians?.[0]?.guardian;
      switch (key) {
        case 'admissionNumber': return s.admissionNumber;
        case 'surname': return s.surname;
        case 'firstName': return s.firstName;
        case 'gender': return s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : '';
        case 'dateOfBirth': return iso(s.dateOfBirth);
        case 'age': return s.dateOfBirth ? ageOn(iso(s.dateOfBirth), today) : '';
        case 'class': return s.currentClass?.name ?? '';
        case 'status': return STATUS_LABEL[s.status];
        case 'boarding': return s.boarding === 'BOARDER' ? 'Boarder' : 'Day scholar';
        case 'house': return s.house?.name ?? '';
        case 'admissionDate': return iso(s.admissionDate);
        case 'previousSchool': return s.previousSchool ?? '';
        case 'isBeam': return s.isBeam ? 'Yes' : 'No';
        case 'sponsorName': return s.sponsorName ?? '';
        case 'guardianName': return g?.fullName ?? '';
        case 'guardianPhone': return g?.phone ?? '';
        case 'guardianNationalId': return g?.nationalId ?? '';
        case 'birthCertificateNumber': return s.birthCertificateNumber ? formatBirthCert(s.birthCertificateNumber) : '';
        case 'incidentCount': return anyS._count?.incidents ?? 0;
        case 'specialNeedsNote': return s.specialNeedsNote ?? '';
        case 'medicalAlert': {
          const allergies = (anyS.medical?.allergies as Allergy[] | undefined) ?? [];
          const conditions = (anyS.medical?.conditions as { name: string }[] | undefined) ?? [];
          return [...allergies.map((a) => `${a.severity === 'SEVERE' ? 'Severe allergy' : 'Allergy'}: ${a.name}`), ...conditions.map((c) => c.name)].join('; ');
        }
        default: return '';
      }
    };

    const headers = columns.map((c) => c.label);
    const rows = students.map((s) => columns.map((c) => value(s, c.key)));

    await logAudit(
      {
        schoolId: user.schoolId, actorId: user.id, action: 'EXPORT_STUDENTS', entityType: 'Student', entityId: 'export',
        detail: `${opts.purpose ?? 'Student list'}: ${students.length} student(s), ${columns.length} column(s)`,
        after: { columns: columns.map((c) => c.key), count: students.length, selected: opts.ids ? opts.ids.length : null, filters: filtersOf(query) },
      },
      tx,
    );
    return { columns, headers, rows, csv: toCsv(headers, rows), count: students.length };
  });
}

/** The filters that were in force, without paging and sorting. */
function filtersOf(q: StudentListQuery): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of ['q', 'termId', 'form', 'classId', 'stream', 'gender', 'status', 'boarding', 'houseId', 'beam', 'sponsored', 'specialNeeds', 'admissionYear', 'count'] as const) {
    const v = q[k];
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}
