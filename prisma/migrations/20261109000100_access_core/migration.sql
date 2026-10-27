-- Access control, part 2 of 3: the structure. Grants get a scope, roles remember what they were copied from, people get a permVersion,
-- and two new tables hold exceptions (overrides) and requests for access. Existing grants keep working exactly as before: every one
-- becomes SCHOOL scope, which is how the code treats them today. The next file fills in the permission catalogue's new columns.

CREATE TYPE "AccessScope" AS ENUM ('SCHOOL', 'DEPARTMENT', 'CLASS', 'ASSIGNED', 'HOSTEL', 'STORE', 'RECORDED_BY_ME', 'SELF', 'CHILDREN');
CREATE TYPE "OverrideEffect" AS ENUM ('GRANT', 'DENY');
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- People and schools
ALTER TABLE "User" ADD COLUMN "permVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "School"
  ADD COLUMN "singlePersonFinance"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deputyLeaveDelegation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "previousTermReadDays"  INTEGER NOT NULL DEFAULT 30,
  ADD CONSTRAINT "School_previousTermReadDays_range" CHECK ("previousTermReadDays" BETWEEN 0 AND 365);

-- Permission catalogue: page, action and the sensitive flag. page/action start empty and are filled (then checked) by the next file.
ALTER TABLE "Permission"
  ADD COLUMN "page"        TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "action"      TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "isSensitive" BOOLEAN NOT NULL DEFAULT false;

-- Roles, grants, assignments
ALTER TABLE "RoleDefinition" ADD COLUMN "copiedFromRoleId" TEXT;
ALTER TABLE "RoleDefinition" ADD CONSTRAINT "RoleDefinition_copiedFromRoleId_fkey" FOREIGN KEY ("copiedFromRoleId") REFERENCES "RoleDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleDefinition" ADD CONSTRAINT "RoleDefinition_not_own_copy" CHECK ("copiedFromRoleId" IS NULL OR "copiedFromRoleId" <> "id");
CREATE INDEX "RoleDefinition_copiedFromRoleId_idx" ON "RoleDefinition"("copiedFromRoleId");

ALTER TABLE "RolePermission" ADD COLUMN "scope" "AccessScope" NOT NULL DEFAULT 'SCHOOL';

ALTER TABLE "UserRole" ADD COLUMN "assignedById" TEXT;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "UserRole_assignedById_idx" ON "UserRole"("assignedById");

-- Overrides
CREATE TABLE "UserPermissionOverride" (
    "id"            TEXT NOT NULL,
    "schoolId"      TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "scope"         "AccessScope" NOT NULL DEFAULT 'SCHOOL',
    "scopeId"       TEXT NOT NULL DEFAULT '',
    "effect"        "OverrideEffect" NOT NULL,
    "reason"        TEXT NOT NULL,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "createdById"   TEXT NOT NULL,
    "revokedAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id"),
    -- A reason is required, and an exception always ends: within 90 days of being made.
    CONSTRAINT "UserPermissionOverride_reason_given" CHECK (char_length(btrim("reason")) >= 3),
    CONSTRAINT "UserPermissionOverride_expiry_window" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '90 days'),
    -- Nobody edits their own permissions (separation of duties, rule 8).
    CONSTRAINT "UserPermissionOverride_not_own" CHECK ("createdById" <> "userId"),
    -- Department, class, hostel and store scopes name which one; the others name nothing. CHILDREN is reserved for the parent portal.
    CONSTRAINT "UserPermissionOverride_scope_id" CHECK (("scope" IN ('DEPARTMENT', 'CLASS', 'HOSTEL', 'STORE')) = ("scopeId" <> '')),
    CONSTRAINT "UserPermissionOverride_scope_not_reserved" CHECK ("scope" <> 'CHILDREN'),
    CONSTRAINT "UserPermissionOverride_no_wildcard" CHECK ("permissionKey" <> '*')
);
CREATE INDEX "UserPermissionOverride_schoolId_userId_idx" ON "UserPermissionOverride"("schoolId", "userId");
CREATE INDEX "UserPermissionOverride_schoolId_expiresAt_idx" ON "UserPermissionOverride"("schoolId", "expiresAt");
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Access requests
CREATE TABLE "AccessRequest" (
    "id"                  TEXT NOT NULL,
    "schoolId"            TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "permissionKey"       TEXT NOT NULL,
    "page"                TEXT NOT NULL,
    "reason"              TEXT NOT NULL,
    "status"              "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById"         TEXT,
    "decidedAt"           TIMESTAMP(3),
    "decisionNote"        TEXT,
    "resultingOverrideId" TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccessRequest_reason_given" CHECK (char_length(btrim("reason")) >= 3),
    -- Open means undecided; decided means by someone, at a time. Nobody decides their own request.
    CONSTRAINT "AccessRequest_decision_shape" CHECK (("status" = 'PENDING') = ("decidedById" IS NULL AND "decidedAt" IS NULL)),
    CONSTRAINT "AccessRequest_not_own" CHECK ("decidedById" IS NULL OR "decidedById" <> "userId"),
    -- A decline says why; only an approval can have made an override.
    CONSTRAINT "AccessRequest_decline_reason" CHECK ("status" <> 'DECLINED' OR char_length(btrim(coalesce("decisionNote", ''))) >= 3),
    CONSTRAINT "AccessRequest_override_only_if_approved" CHECK ("resultingOverrideId" IS NULL OR "status" = 'APPROVED')
);
CREATE UNIQUE INDEX "AccessRequest_resultingOverrideId_key" ON "AccessRequest"("resultingOverrideId");
-- One open request per person per key.
CREATE UNIQUE INDEX "AccessRequest_one_open" ON "AccessRequest"("userId", "permissionKey") WHERE "status" = 'PENDING';
CREATE INDEX "AccessRequest_schoolId_status_idx" ON "AccessRequest"("schoolId", "status");
CREATE INDEX "AccessRequest_userId_idx" ON "AccessRequest"("userId");
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_resultingOverrideId_fkey" FOREIGN KEY ("resultingOverrideId") REFERENCES "UserPermissionOverride"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same protection as the other school tables: one school cannot see another's rows, and every change is audited.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['UserPermissionOverride', 'AccessRequest'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"))', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change()', 'audit_' || t, t);
  END LOOP;
END $$;
