-- Users page: several roles per person, phone, title, invites.
--  * StaffRole: the 13 roles a person can hold; a user holds one or more (User.staffRoles).
--  * The older single User.role stays: it is the access level the existing pages use and is
--    worked out from the roles. Older code that still sets only "role" keeps working because a
--    trigger keeps staffRoles in step (and the other way round is done by the app).
--  * Invites: a password link kind with a longer life; invitePending marks a person who has not
--    chosen a password yet.

ALTER TYPE "AuditAction" ADD VALUE 'INVITE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'ACCEPT_INVITE';
ALTER TYPE "AuditAction" ADD VALUE 'IMPORT_USERS';

CREATE TYPE "StaffRole" AS ENUM (
  'SCHOOL_ADMINISTRATOR', 'OWNER', 'HEAD_TEACHER', 'DEPUTY_HEAD', 'SENIOR_TEACHER', 'HEAD_OF_DEPARTMENT',
  'CLASS_TEACHER', 'TEACHER', 'BURSAR', 'ACCOUNTS_CLERK', 'LIBRARIAN', 'REGISTRAR', 'OFFICE_SECRETARY');
CREATE TYPE "PasswordTokenKind" AS ENUM ('RESET', 'INVITE');

ALTER TABLE "User"
  ADD COLUMN "phone"         TEXT,
  ADD COLUMN "title"         TEXT,
  ADD COLUMN "staffRoles"    "StaffRole"[] NOT NULL DEFAULT ARRAY[]::"StaffRole"[],
  ADD COLUMN "invitePending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "invitedAt"     TIMESTAMP(3),
  ADD CONSTRAINT "User_title_known" CHECK ("title" IS NULL OR "title" IN ('Mr', 'Mrs', 'Ms', 'Dr')),
  ADD CONSTRAINT "User_phone_format" CHECK ("phone" IS NULL OR "phone" ~ '^\+263[0-9]{9}$');

ALTER TABLE "PasswordResetToken" ADD COLUMN "kind" "PasswordTokenKind" NOT NULL DEFAULT 'RESET';

-- The access level (the older single role) that goes with a staff role.
CREATE OR REPLACE FUNCTION staff_role_for(r "Role") RETURNS "StaffRole"
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'ADMIN'     THEN 'SCHOOL_ADMINISTRATOR'::"StaffRole"
    WHEN 'DIRECTOR'  THEN 'OWNER'::"StaffRole"
    WHEN 'HEAD'      THEN 'HEAD_TEACHER'::"StaffRole"
    WHEN 'BURSAR'    THEN 'BURSAR'::"StaffRole"
    WHEN 'LIBRARIAN' THEN 'LIBRARIAN'::"StaffRole"
    ELSE 'TEACHER'::"StaffRole"
  END
$$;

-- A user always has at least one staff role. Code that creates a user with only "role" gets the
-- matching staff role; code that changes only "role" replaces the staff roles with the matching one.
CREATE OR REPLACE FUNCTION user_default_staff_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(NEW."staffRoles") = 0 THEN
    NEW."staffRoles" := ARRAY[staff_role_for(NEW."role")];
  ELSIF TG_OP = 'UPDATE' AND NEW."role" IS DISTINCT FROM OLD."role" AND NEW."staffRoles" = OLD."staffRoles" THEN
    NEW."staffRoles" := ARRAY[staff_role_for(NEW."role")];
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "user_default_staff_roles" BEFORE INSERT OR UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION user_default_staff_roles();
