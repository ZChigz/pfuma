-- Access control, part 3 of 3: fills the permission catalogue's new columns for the keys that already exist, then makes the database
-- keep them honest. Running it again changes nothing.
--   * page and action are the 2nd and 3rd part of the key ("*" is page and action "*");
--   * isSensitive is true for the keys whose reads and refusals are audited: medical details, guardian ID numbers, discipline history,
--     staff pay and payroll, staff discipline, voids, refund approval, role changes, and every export.
-- No grant, role or person changes here.

UPDATE "Permission"
   SET "page"   = CASE WHEN "key" = '*' THEN '*' ELSE split_part("key", '.', 2) END,
       "action" = CASE WHEN "key" = '*' THEN '*' ELSE split_part("key", '.', 3) END
 WHERE "page" = '' OR "action" = '';

UPDATE "Permission" SET "isSensitive" = true
 WHERE "key" <> '*' AND (
        "key" LIKE 'students.medical.%'
     OR "key" IN ('students.guardians.view_ids', 'students.discipline.view', 'hr.discipline.view',
                  'finance.payments.void', 'finance.charges.void', 'finance.expenses.void', 'finance.refunds.approve', 'system.roles.edit')
     OR "key" LIKE 'hr.pay.%'
     OR "key" LIKE 'hr.payroll.%'
     OR "action" = 'export');

-- From here on every catalogue row must say its own page and action.
ALTER TABLE "Permission" ALTER COLUMN "page" DROP DEFAULT;
ALTER TABLE "Permission" ALTER COLUMN "action" DROP DEFAULT;
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_parts_match" CHECK (
  "key" = '*' OR ("page" = split_part("key", '.', 2) AND "action" = split_part("key", '.', 3) AND "module" = split_part("key", '.', 1))
);
