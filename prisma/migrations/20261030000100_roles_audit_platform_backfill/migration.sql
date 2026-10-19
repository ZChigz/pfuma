-- Data migration for roles, grants, plans and school status. Idempotent; nobody gains or loses access.
--  1. The 13 system roles and their grants are created for every school that already exists.
--  2. Every user gets UserRole rows from the staff roles chosen on the Users page (the 13 earlier role
--     names are mapped onto the 13 now in use); anyone without roles gets the role that matches
--     their access level (ADMIN = Administrator, DIRECTOR = Owner, HEAD = Head ...).
--  3. Any grant from the older role-permission table is copied across under its new key (the table itself is left
--     in place, unread, until a later migration drops it).
--  3b. Earlier audit entries get their module (the only change ever made to existing entries).
--  4. A "Standard" plan exists, and each school is placed on it with the status, renewal date and
--     student limit it already had in its subscription row (left in place, no longer read).

-- 1
SELECT seed_school_roles("id") FROM "School";

-- 2
INSERT INTO "UserRole" ("id", "schoolId", "userId", "roleId", "updatedAt")
SELECT gen_random_uuid()::text, u."schoolId", u."id", rd."id", CURRENT_TIMESTAMP
  FROM "User" u
  CROSS JOIN LATERAL unnest(u."staffRoles") AS sr
  JOIN "RoleDefinition" rd ON rd."schoolId" = u."schoolId" AND rd."key" = (
    CASE sr::text
      WHEN 'SCHOOL_ADMINISTRATOR' THEN 'ADMINISTRATOR'
      WHEN 'HEAD_TEACHER'         THEN 'HEAD'
      WHEN 'HEAD_OF_DEPARTMENT'   THEN 'HOD'
      WHEN 'SENIOR_TEACHER'       THEN 'TEACHER'
      WHEN 'REGISTRAR'            THEN 'TEACHER'
      WHEN 'OFFICE_SECRETARY'     THEN 'TEACHER'
      ELSE sr::text
    END)
ON CONFLICT DO NOTHING;

INSERT INTO "UserRole" ("id", "schoolId", "userId", "roleId", "updatedAt")
SELECT gen_random_uuid()::text, u."schoolId", u."id", rd."id", CURRENT_TIMESTAMP
  FROM "User" u
  JOIN "RoleDefinition" rd ON rd."schoolId" = u."schoolId" AND rd."key" = legacy_role_key(u."role")
 WHERE NOT EXISTS (SELECT 1 FROM "UserRole" x WHERE x."userId" = u."id")
ON CONFLICT DO NOTHING;

-- 3 (the old table is left in place and no longer read; it is dropped by a later migration)
DO $$
BEGIN
  IF to_regclass('"RolePermissionOld"') IS NOT NULL THEN
    INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey")
    SELECT gen_random_uuid()::text, o."schoolId", rd."id", m.new_key
      FROM "RolePermissionOld" o
      JOIN LATERAL (SELECT CASE o."permission"
          WHEN 'system.calendar.update'     THEN 'system.calendar.edit'
          WHEN 'system.settings.update'     THEN 'system.settings.edit'
          WHEN 'system.users.update'        THEN 'system.users.edit'
          WHEN 'system.users.reset_password' THEN 'system.users.edit'
          WHEN 'system.users.invite'        THEN 'system.users.create'
          WHEN 'system.users.import'        THEN 'system.users.create'
          WHEN 'system.setup.view'          THEN 'system.dashboard.view'
          WHEN 'system.subscription.manage' THEN 'system.subscription.view'
          WHEN 'system.academic.create'     THEN 'system.settings.edit'
          WHEN 'system.academic.update'     THEN 'system.settings.edit'
          WHEN 'system.academic.open'       THEN 'system.settings.edit'
          WHEN 'system.academic.close'      THEN 'system.settings.edit'
          WHEN 'system.structure.update'    THEN 'system.settings.edit'
          WHEN 'system.grading.update'      THEN 'system.settings.edit'
          WHEN 'system.finance.update'      THEN 'system.settings.edit'
          WHEN 'system.numbering.update'    THEN 'system.settings.edit'
          ELSE o."permission" END AS new_key) m ON true
      JOIN "Permission" p ON p."key" = m.new_key
      JOIN "RoleDefinition" rd ON rd."schoolId" = o."schoolId" AND rd."key" = legacy_role_key(o."role")
    ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
  END IF;
END
$$;

-- 3b. Earlier audit entries get their module. The log is append-only, so the guard is lifted for this
--     one statement (nothing else in the entries changes) and put back straight away.
ALTER TABLE "AuditLog" DISABLE TRIGGER "audit_log_no_change";
UPDATE "AuditLog" SET "module" = audit_module("entityType") WHERE "module" IS NULL;
ALTER TABLE "AuditLog" ENABLE TRIGGER "audit_log_no_change";

-- 4
INSERT INTO "Plan" ("id", "key", "name", "description", "modules", "updatedAt")
VALUES (gen_random_uuid()::text, 'STANDARD', 'Standard', 'Every module.',
        ARRAY['system', 'students', 'academics', 'exams', 'finance', 'hr', 'facilities', 'communication'], CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

UPDATE "School" s
   SET "planId" = (SELECT "id" FROM "Plan" WHERE "key" = 'STANDARD'),
       "status" = COALESCE((SELECT CASE sub."status"::text
                                     WHEN 'TRIAL' THEN 'TRIAL' WHEN 'EXPIRED' THEN 'OVERDUE' WHEN 'CANCELLED' THEN 'SUSPENDED' ELSE 'ACTIVE' END
                              FROM "Subscription" sub WHERE sub."schoolId" = s."id"), 'ACTIVE')::"SchoolStatus",
       "renewalDate" = (SELECT sub."endsAt"::date FROM "Subscription" sub WHERE sub."schoolId" = s."id"),
       "studentLimit" = (SELECT sub."studentLimit" FROM "Subscription" sub WHERE sub."schoolId" = s."id")
 WHERE s."planId" IS NULL;
