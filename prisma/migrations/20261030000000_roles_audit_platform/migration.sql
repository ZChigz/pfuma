-- Roles and permissions as data, audit proof, notifications, subscription and the Pfuma console.
--
--  * RoleDefinition / Permission / RolePermission / UserRole: who may do what is rows, not code.
--    The 13 system roles and their grants are created for every school by a trigger when the
--    school is inserted (and by the next migration for schools that already exist).
--  * AuditLog gets the caller's IP address and browser; it stays append only.
--  * Notification: a type, "link" (was href) and a key that makes scheduled notices safe to repeat.
--  * School: status, plan, renewal date and student limit; Plan, SubscriptionInvoice for billing.
--  * PlatformAdmin, PlatformAuditLog: Pfuma staff and their log. They are separate from school users,
--    so a school query can never return one of them.
--  The older User.staffRoles column is no longer read; it is dropped in a later "contract" migration.

ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE 'SUPPORT_ACCESS_STARTED';
ALTER TYPE "AuditAction" ADD VALUE 'SUPPORT_ACCESS_ENDED';
ALTER TYPE "AuditAction" ADD VALUE 'ROLES_CHANGED';

CREATE TYPE "RoleScopeType" AS ENUM ('SCHOOL', 'DEPARTMENT', 'CLASS', 'HOSTEL');
CREATE TYPE "SchoolStatus" AS ENUM ('TRIAL', 'ACTIVE', 'OVERDUE', 'SUSPENDED');
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- ── The permission catalogue ────────────────────────────────────────────────
CREATE TABLE "Permission" (
    "key"         TEXT NOT NULL,
    "module"      TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "Permission_key_shape" CHECK ("key" = '*' OR "key" ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')
);

INSERT INTO "Permission" ("key", "module", "description") VALUES
  ('*',                       '*',      'Everything, in every module'),
  ('system.dashboard.view',   'system', 'See the dashboard'),
  ('system.calendar.view',    'system', 'See the school calendar'),
  ('system.calendar.create',  'system', 'Add calendar events'),
  ('system.calendar.edit',    'system', 'Change calendar events'),
  ('system.calendar.delete',  'system', 'Delete calendar events'),
  ('system.calendar.export',  'system', 'Export the calendar to PDF'),
  ('system.settings.view',    'system', 'See the school settings'),
  ('system.settings.edit',    'system', 'Change the school settings'),
  ('system.users.view',       'system', 'See the users'),
  ('system.users.create',     'system', 'Add, invite and import users'),
  ('system.users.edit',       'system', 'Change users, their roles and their passwords'),
  ('system.users.deactivate', 'system', 'Deactivate and reactivate users'),
  ('system.users.export',     'system', 'Export the user list'),
  ('system.roles.view',       'system', 'See roles and permissions'),
  ('system.roles.edit',       'system', 'Change what a role may do'),
  ('system.audit.view',       'system', 'See the audit log'),
  ('system.audit.export',     'system', 'Export the audit log'),
  ('system.subscription.view','system', 'See the subscription and invoices');

-- ── Roles ───────────────────────────────────────────────────────────────────
CREATE TABLE "RoleDefinition" (
    "id"          TEXT NOT NULL,
    "schoolId"    TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isSystem"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoleDefinition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RoleDefinition_key_shape" CHECK ("key" ~ '^[A-Z][A-Z_]*$')
);
CREATE UNIQUE INDEX "RoleDefinition_schoolId_key_key" ON "RoleDefinition"("schoolId", "key");
CREATE INDEX "RoleDefinition_schoolId_idx" ON "RoleDefinition"("schoolId");
ALTER TABLE "RoleDefinition" ADD CONSTRAINT "RoleDefinition_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The older table (role enum + free-text permission) is set aside; the next migration copies its rows.
DROP TRIGGER IF EXISTS "audit_RolePermission" ON "RolePermission";
ALTER TABLE "RolePermission" RENAME TO "RolePermissionOld";
ALTER INDEX "RolePermission_pkey" RENAME TO "RolePermissionOld_pkey";
ALTER INDEX "RolePermission_schoolId_role_permission_key" RENAME TO "RolePermissionOld_schoolId_role_permission_key";
ALTER INDEX "RolePermission_schoolId_idx" RENAME TO "RolePermissionOld_schoolId_idx";
ALTER TABLE "RolePermissionOld" RENAME CONSTRAINT "RolePermission_schoolId_fkey" TO "RolePermissionOld_schoolId_fkey";

CREATE TABLE "RolePermission" (
    "id"            TEXT NOT NULL,
    "schoolId"      TEXT NOT NULL,
    "roleId"        TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RolePermission_roleId_permissionKey_key" ON "RolePermission"("roleId", "permissionKey");
CREATE INDEX "RolePermission_schoolId_idx" ON "RolePermission"("schoolId");
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UserRole" (
    "id"        TEXT NOT NULL,
    "schoolId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "roleId"    TEXT NOT NULL,
    "scopeType" "RoleScopeType" NOT NULL DEFAULT 'SCHOOL',
    "scopeId"   TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserRole_school_scope_has_no_id" CHECK ("scopeType" <> 'SCHOOL' OR "scopeId" = '')
);
CREATE UNIQUE INDEX "UserRole_userId_roleId_scopeType_scopeId_key" ON "UserRole"("userId", "roleId", "scopeType", "scopeId");
CREATE INDEX "UserRole_schoolId_idx" ON "UserRole"("schoolId");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "RoleDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['RoleDefinition', 'RolePermission', 'UserRole'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
  END LOOP;
END $$;
CREATE TRIGGER "same_school_RolePermission" BEFORE INSERT OR UPDATE OF "roleId" ON "RolePermission"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('roleId:RoleDefinition');
CREATE TRIGGER "same_school_UserRole" BEFORE INSERT OR UPDATE OF "userId", "roleId" ON "UserRole"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('userId:User', 'roleId:RoleDefinition');

-- ── The 13 system roles, created for a school ───────────────────────────────
CREATE OR REPLACE FUNCTION legacy_role_key(r "Role") RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'ADMIN'     THEN 'ADMINISTRATOR'
    WHEN 'DIRECTOR'  THEN 'OWNER'
    WHEN 'HEAD'      THEN 'HEAD'
    WHEN 'BURSAR'    THEN 'BURSAR'
    WHEN 'LIBRARIAN' THEN 'LIBRARIAN'
    ELSE 'TEACHER'
  END
$$;

CREATE OR REPLACE FUNCTION seed_school_roles(sid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "RoleDefinition" ("id", "schoolId", "key", "name", "description", "isSystem", "updatedAt")
  SELECT gen_random_uuid()::text, sid, v.k, v.n, v.d, true, CURRENT_TIMESTAMP
    FROM (VALUES
      ('OWNER',           'Owner',              'Owns the school. Full access to everything.'),
      ('HEAD',            'Head',               'The head of the school. Oversees teaching, staff and finance.'),
      ('DEPUTY_HEAD',     'Deputy Head',        'Supports the head and runs day-to-day discipline and timetabling.'),
      ('ADMINISTRATOR',   'Administrator',      'Runs the system for the school: users, settings, calendar and records.'),
      ('BURSAR',          'Bursar',             'Manages fees, payments, expenses and the school accounts.'),
      ('ACCOUNTS_CLERK',  'Accounts Clerk',     'Records payments and keeps the daily accounts under the bursar.'),
      ('HR_OFFICER',      'HR Officer',         'Looks after staff records, leave and payroll.'),
      ('HOD',             'Head of Department', 'Leads a subject department and its teachers.'),
      ('TEACHER',         'Teacher',            'Teaches classes and enters marks for their subjects.'),
      ('CLASS_TEACHER',   'Class Teacher',      'Looks after one class: register, remarks and report cards.'),
      ('EXAMS_OFFICER',   'Exams Officer',      'Runs internal and ZIMSEC examinations and their results.'),
      ('LIBRARIAN',       'Librarian',          'Runs the library: books, borrowing and fines.'),
      ('BOARDING_MASTER', 'Boarding Master',    'Looks after the boarding hostels and the boarders.')
    ) AS v(k, n, d)
  ON CONFLICT ("schoolId", "key") DO NOTHING;

  -- Everyone can see the dashboard and the calendar, so every member of staff lands somewhere.
  -- Owner and Administrator may do everything. Nothing else is granted yet.
  INSERT INTO "RolePermission" ("id", "schoolId", "roleId", "permissionKey")
  SELECT gen_random_uuid()::text, sid, rd."id", p.k
    FROM "RoleDefinition" rd
    CROSS JOIN LATERAL unnest(
      CASE WHEN rd."key" IN ('OWNER', 'ADMINISTRATOR')
           THEN ARRAY['*', 'system.dashboard.view', 'system.calendar.view']
           ELSE ARRAY['system.dashboard.view', 'system.calendar.view'] END) AS p(k)
   WHERE rd."schoolId" = sid
  ON CONFLICT ("roleId", "permissionKey") DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION school_seed_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_school_roles(NEW."id");
  RETURN NEW;
END;
$$;
CREATE TRIGGER "school_seed_roles" AFTER INSERT ON "School" FOR EACH ROW EXECUTE FUNCTION school_seed_roles();

-- A new user gets the role that matches their access level, unless the app chooses roles itself
-- (it replaces this row in the same transaction). Older code that only sets "role" keeps working,
-- and a changed "role" resets the roles to the matching one.
CREATE OR REPLACE FUNCTION user_default_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM "UserRole" WHERE "userId" = NEW."id";
  END IF;
  INSERT INTO "UserRole" ("id", "schoolId", "userId", "roleId", "updatedAt")
  SELECT gen_random_uuid()::text, NEW."schoolId", NEW."id", rd."id", CURRENT_TIMESTAMP
    FROM "RoleDefinition" rd
   WHERE rd."schoolId" = NEW."schoolId" AND rd."key" = legacy_role_key(NEW."role")
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "user_default_role_insert" AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION user_default_role();
CREATE TRIGGER "user_default_role_update" AFTER UPDATE OF "role" ON "User" FOR EACH ROW WHEN (OLD."role" IS DISTINCT FROM NEW."role") EXECUTE FUNCTION user_default_role();

-- The 13 system roles stay: they cannot be deleted, renamed to another key, or turned into ordinary roles.
CREATE OR REPLACE FUNCTION role_definition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."isSystem" THEN RAISE EXCEPTION 'System roles cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."isSystem" AND (NEW."key" <> OLD."key" OR NOT NEW."isSystem") THEN
    RAISE EXCEPTION 'System roles cannot be changed this way';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "role_definition_guard" BEFORE UPDATE OR DELETE ON "RoleDefinition" FOR EACH ROW EXECUTE FUNCTION role_definition_guard();

-- The staff-role array of the previous migration is replaced by UserRole.
DROP TRIGGER IF EXISTS "user_default_staff_roles" ON "User";
DROP FUNCTION IF EXISTS user_default_staff_roles();

-- ── Users, audit log, notifications, modules ────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN "photoUrl"  TEXT,
  ADD COLUMN "isSupport" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "User_photoUrl_https" CHECK ("photoUrl" IS NULL OR "photoUrl" ~ '^https://');

ALTER TABLE "AuditLog" ADD COLUMN "module" TEXT, ADD COLUMN "ip" TEXT, ADD COLUMN "userAgent" TEXT;
CREATE INDEX "AuditLog_schoolId_createdAt_idx" ON "AuditLog"("schoolId", "createdAt");

-- Which part of Pfuma a record type belongs to (the audit log can be filtered by it).
CREATE OR REPLACE FUNCTION audit_module(entity text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN entity IN ('Student', 'Guardian', 'StudentGuardian', 'Enrolment', 'Absence') THEN 'students'
    WHEN entity IN ('SubjectAssignment', 'Subject', 'Timetable') THEN 'academics'
    WHEN entity IN ('Mark', 'TermResult', 'ReportCard', 'MarkChange') THEN 'exams'
    WHEN entity IN ('Payment', 'Expense', 'ExpenseRequest', 'Charge', 'FeeStructure', 'Income', 'ExchangeRate') THEN 'finance'
    WHEN entity IN ('Asset', 'AssetTransfer', 'Book', 'BookCopy', 'Borrowing', 'LibraryMember') THEN 'facilities'
    ELSE 'system'
  END
$$;
-- Whoever writes an entry, the caller's address and browser go with it (the app sets them per request).
CREATE OR REPLACE FUNCTION audit_log_request_meta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."module" := COALESCE(NEW."module", audit_module(NEW."entityType"));
  NEW."ip" := COALESCE(NEW."ip", NULLIF(current_setting('app.ip', true), ''));
  NEW."userAgent" := COALESCE(NEW."userAgent", left(NULLIF(current_setting('app.user_agent', true), ''), 300));
  RETURN NEW;
END;
$$;
CREATE TRIGGER "audit_log_request_meta" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_request_meta();

ALTER TABLE "Notification" RENAME COLUMN "href" TO "link";
ALTER TABLE "Notification"
  ADD COLUMN "type"      TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

ALTER TABLE "SchoolModule" ADD COLUMN "enabledAt" TIMESTAMP(3), ADD COLUMN "enabledByPlatformAdminId" TEXT;

-- Every school table carries createdAt and updatedAt (the audit log is append-only, so it has no updatedAt).
ALTER TABLE "RolePermission"      ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SchoolModule"        ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Notification"        ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PasswordResetToken"  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── Plans, school status, invoices ──────────────────────────────────────────
CREATE TABLE "Plan" (
    "id"                  TEXT NOT NULL,
    "key"                 TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "description"         TEXT NOT NULL DEFAULT '',
    "modules"             TEXT[] NOT NULL,
    "defaultStudentLimit" INTEGER,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Plan_limit_positive" CHECK ("defaultStudentLimit" IS NULL OR "defaultStudentLimit" > 0)
);
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

ALTER TABLE "School"
  ADD COLUMN "status"          "SchoolStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "planId"          TEXT,
  ADD COLUMN "renewalDate"     DATE,
  ADD COLUMN "studentLimit"    INTEGER,
  ADD COLUMN "suspendedReason" TEXT,
  ADD CONSTRAINT "School_studentLimit_positive" CHECK ("studentLimit" IS NULL OR "studentLimit" > 0),
  ADD CONSTRAINT "School_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SubscriptionInvoice" (
    "id"               TEXT NOT NULL,
    "schoolId"         TEXT NOT NULL,
    "number"           TEXT NOT NULL,
    "issuedOn"         DATE NOT NULL,
    "dueOn"            DATE,
    "amount"           DECIMAL(14,2) NOT NULL,
    "currency"         "Currency" NOT NULL DEFAULT 'USD',
    "description"      TEXT NOT NULL,
    "status"           "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "paidOn"           DATE,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SubscriptionInvoice_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "SubscriptionInvoice_paid_has_date" CHECK (("status" = 'PAID') = ("paidOn" IS NOT NULL))
);
CREATE UNIQUE INDEX "SubscriptionInvoice_number_key" ON "SubscriptionInvoice"("number");
CREATE INDEX "SubscriptionInvoice_schoolId_idx" ON "SubscriptionInvoice"("schoolId");
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionInvoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "SubscriptionInvoice" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));

-- ── Pfuma staff and their log ───────────────────────────────────────────────
CREATE TABLE "PlatformAdmin" (
    "id"           TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "fullName"     TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active"       BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

CREATE TABLE "PlatformAuditLog" (
    "id"         TEXT NOT NULL,
    "adminId"    TEXT NOT NULL,
    "action"     TEXT NOT NULL,
    "schoolId"   TEXT,
    "entityType" TEXT NOT NULL,
    "entityId"   TEXT NOT NULL,
    "detail"     TEXT,
    "before"     JSONB,
    "after"      JSONB,
    "ip"         TEXT,
    "userAgent"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");
CREATE INDEX "PlatformAuditLog_schoolId_idx" ON "PlatformAuditLog"("schoolId");
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "platform_audit_log_no_change" BEFORE UPDATE OR DELETE ON "PlatformAuditLog" FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
