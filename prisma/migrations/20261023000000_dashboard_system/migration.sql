-- Dashboard & System: school profile, subscription, module switches, role permissions,
-- notifications and calendar events.

ALTER TYPE "AuditAction" ADD VALUE 'DEACTIVATE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'REACTIVATE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_SCHOOL_MODULES';
ALTER TYPE "AuditAction" ADD VALUE 'CREATE_CALENDAR_EVENT';
ALTER TYPE "AuditAction" ADD VALUE 'UPDATE_CALENDAR_EVENT';
ALTER TYPE "AuditAction" ADD VALUE 'DELETE_CALENDAR_EVENT';

CREATE TYPE "SchoolType" AS ENUM ('GOVERNMENT', 'PRIVATE');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED');
CREATE TYPE "CalendarEventKind" AS ENUM ('HOLIDAY', 'EXAM', 'SPORTS', 'MEETING', 'OTHER');

ALTER TABLE "School"
  ADD COLUMN "schoolType"      "SchoolType" NOT NULL DEFAULT 'GOVERNMENT',
  ADD COLUMN "phone"           TEXT,
  ADD COLUMN "email"           TEXT,
  ADD COLUMN "address"         TEXT,
  ADD COLUMN "motto"           TEXT,
  ADD COLUMN "logoUrl"         TEXT,
  ADD COLUMN "defaultCurrency" "Currency" NOT NULL DEFAULT 'USD';

CREATE TABLE "Subscription" (
    "id"           TEXT NOT NULL,
    "schoolId"     TEXT NOT NULL,
    "plan"         TEXT NOT NULL DEFAULT 'STANDARD',
    "status"       "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt"       TIMESTAMP(3),
    "studentLimit" INTEGER,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Subscription_dates" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt"),
    CONSTRAINT "Subscription_limit_positive" CHECK ("studentLimit" IS NULL OR "studentLimit" > 0)
);
CREATE UNIQUE INDEX "Subscription_schoolId_key" ON "Subscription"("schoolId");

CREATE TABLE "SchoolModule" (
    "id"        TEXT NOT NULL,
    "schoolId"  TEXT NOT NULL,
    "module"    TEXT NOT NULL,
    "enabled"   BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchoolModule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SchoolModule_system_always_on" CHECK ("module" <> 'system' OR "enabled")
);
CREATE UNIQUE INDEX "SchoolModule_schoolId_module_key" ON "SchoolModule"("schoolId", "module");
CREATE INDEX "SchoolModule_schoolId_idx" ON "SchoolModule"("schoolId");

CREATE TABLE "RolePermission" (
    "id"         TEXT NOT NULL,
    "schoolId"   TEXT NOT NULL,
    "role"       "Role" NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RolePermission_schoolId_role_permission_key" ON "RolePermission"("schoolId", "role", "permission");
CREATE INDEX "RolePermission_schoolId_idx" ON "RolePermission"("schoolId");

CREATE TABLE "Notification" (
    "id"        TEXT NOT NULL,
    "schoolId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT,
    "href"      TEXT,
    "readAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_schoolId_idx" ON "Notification"("schoolId");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

CREATE TABLE "CalendarEvent" (
    "id"          TEXT NOT NULL,
    "schoolId"    TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "kind"        "CalendarEventKind" NOT NULL DEFAULT 'OTHER',
    "startDate"   DATE NOT NULL,
    "endDate"     DATE NOT NULL,
    "notes"       TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CalendarEvent_dates" CHECK ("endDate" >= "startDate")
);
CREATE INDEX "CalendarEvent_schoolId_startDate_idx" ON "CalendarEvent"("schoolId", "startDate");

ALTER TABLE "Subscription"   ADD CONSTRAINT "Subscription_schoolId_fkey"     FOREIGN KEY ("schoolId")    REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SchoolModule"   ADD CONSTRAINT "SchoolModule_schoolId_fkey"     FOREIGN KEY ("schoolId")    REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_schoolId_fkey"   FOREIGN KEY ("schoolId")    REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification"   ADD CONSTRAINT "Notification_schoolId_fkey"     FOREIGN KEY ("schoolId")    REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification"   ADD CONSTRAINT "Notification_userId_fkey"       FOREIGN KEY ("userId")      REFERENCES "User"("id")   ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent"  ADD CONSTRAINT "CalendarEvent_schoolId_fkey"    FOREIGN KEY ("schoolId")    REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent"  ADD CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id")   ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security and same-school references, like every other school-owned table.
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Subscription" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "SchoolModule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolModule" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "SchoolModule" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "RolePermission" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "Notification" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));
ALTER TABLE "CalendarEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON "CalendarEvent" USING (app_school_ok("schoolId")) WITH CHECK (app_school_ok("schoolId"));

CREATE TRIGGER "same_school_Notification" BEFORE INSERT OR UPDATE OF "userId" ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('userId:User');
CREATE TRIGGER "same_school_CalendarEvent" BEFORE INSERT OR UPDATE OF "createdById" ON "CalendarEvent"
  FOR EACH ROW EXECUTE FUNCTION check_same_school('createdById:User');

-- Row-change history for the tables whose edits change what people can do or see.
CREATE TRIGGER "audit_SchoolModule" AFTER INSERT OR UPDATE OR DELETE ON "SchoolModule"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_RolePermission" AFTER INSERT OR UPDATE OR DELETE ON "RolePermission"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER "audit_CalendarEvent" AFTER INSERT OR UPDATE OR DELETE ON "CalendarEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
