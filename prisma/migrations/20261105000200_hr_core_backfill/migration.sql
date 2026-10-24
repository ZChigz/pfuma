-- HR & Staff core — step 2 of 2 (data). Idempotent; nothing is deleted and nobody gains access to anything.
--
-- Every active user of a school (apart from the hidden Pfuma support accounts) becomes an Employee linked to that login, so the
-- directory, attendance and leave know who they are from the first day. Inactive users are not carried over: nobody can say when or why
-- they left, and HR adds a leaver with the real date and reason. The employee number is EMP-0001, EMP-0002 ... per school, in the order
-- the logins were created.
--
-- Two guesses HR must check (they are shown on the staff list):
--   * Teachers and Heads start as GOVERNMENT-paid (so none of them can appear in a school payroll by accident); everyone else
--     starts as SCHOOL-paid. HR changes the employer, with a reason, for the school-paid teachers.
--   * Job title comes from the access level (Teacher, Head, Bursar ...); HR corrects it.
INSERT INTO "Employee" ("id", "schoolId", "employeeNo", "userId", "title", "firstName", "surname", "workPhone", "jobTitle", "category", "employer", "startDate", "status", "createdById", "updatedAt")
SELECT gen_random_uuid()::text, n."schoolId", 'EMP-' || lpad((n."base" + n."rn")::text, 4, '0'), n."id", n."title",
       CASE WHEN position(' ' in btrim(n."fullName")) > 0 THEN split_part(btrim(n."fullName"), ' ', 1) ELSE btrim(n."fullName") END,
       CASE WHEN position(' ' in btrim(n."fullName")) > 0 THEN btrim(substr(btrim(n."fullName"), position(' ' in btrim(n."fullName")) + 1)) ELSE btrim(n."fullName") END,
       n."phone",
       CASE n."role"::text WHEN 'TEACHER' THEN 'Teacher' WHEN 'HEAD' THEN 'Head' WHEN 'DIRECTOR' THEN 'Owner' WHEN 'ADMIN' THEN 'Administrator'
                          WHEN 'BURSAR' THEN 'Bursar' WHEN 'LIBRARIAN' THEN 'Librarian' ELSE 'Staff member' END,
       CASE WHEN n."role"::text IN ('TEACHER', 'HEAD') THEN 'TEACHING' ELSE 'ADMINISTRATION' END::"EmployeeCategory",
       CASE WHEN n."role"::text IN ('TEACHER', 'HEAD') THEN 'GOVERNMENT' ELSE 'SCHOOL' END::"HrEmployer",
       n."createdAt"::date, 'ACTIVE', n."id", CURRENT_TIMESTAMP
  FROM (
    SELECT u.*, row_number() OVER (PARTITION BY u."schoolId" ORDER BY u."createdAt", u."id") AS "rn",
           (SELECT coalesce(max(substr(e."employeeNo", 5)::int), 0) FROM "Employee" e WHERE e."schoolId" = u."schoolId" AND e."employeeNo" ~ '^EMP-[0-9]+$') AS "base"
      FROM "User" u
     WHERE u."active" = true AND u."isSupport" = false
       AND NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e."userId" = u."id")
  ) n;

INSERT INTO "HrSequence" ("id", "schoolId", "key", "nextNumber")
SELECT gen_random_uuid()::text, e."schoolId", 'EMP', max(substr(e."employeeNo", 5)::int) + 1
  FROM "Employee" e WHERE e."employeeNo" ~ '^EMP-[0-9]+$' GROUP BY e."schoolId"
ON CONFLICT ("schoolId", "key") DO UPDATE SET "nextNumber" = GREATEST("HrSequence"."nextNumber", EXCLUDED."nextNumber");
