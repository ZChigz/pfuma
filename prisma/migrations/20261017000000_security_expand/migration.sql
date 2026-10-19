-- Security hardening — step 1 of 3: EXPAND
-- Adds session versioning, hashed portal links + PIN, portal view log,
-- audit before/after columns, private proof-of-payment keys and the fair-ranking
-- columns. Nothing is dropped: the plaintext "Student.portalToken" column stays
-- (now nullable, no default) until the contract migration, after the backfill
-- has hashed and emptied it.

-- AlterEnum (used by code and by the audit trigger, never inside this migration)
ALTER TYPE "AuditAction" ADD VALUE 'DATA_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'DATA_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'DATA_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_LOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'LOGOUT_ALL_SESSIONS';
ALTER TYPE "AuditAction" ADD VALUE 'CHANGE_PASSWORD';
ALTER TYPE "AuditAction" ADD VALUE 'REGENERATE_PORTAL_LINK';
ALTER TYPE "AuditAction" ADD VALUE 'SET_PORTAL_PIN';
ALTER TYPE "AuditAction" ADD VALUE 'VOID_WITHOUT_SECOND_APPROVER';
ALTER TYPE "AuditAction" ADD VALUE 'UNPUBLISH_RESULTS';

-- User: session versioning and forced password change
ALTER TABLE "User"
  ADD COLUMN "tokenVersion"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt"  TIMESTAMP(3);

-- Student: hashed portal link, expiry and PIN
ALTER TABLE "Student"
  ALTER COLUMN "portalToken" DROP NOT NULL,
  ALTER COLUMN "portalToken" DROP DEFAULT,
  ADD COLUMN "portalTokenHash"      TEXT,
  ADD COLUMN "portalTokenCreatedAt" TIMESTAMP(3),
  ADD COLUMN "portalTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "portalPinHash"        TEXT;
CREATE UNIQUE INDEX "Student_portalTokenHash_key" ON "Student"("portalTokenHash");

-- Portal view log
CREATE TABLE "PortalAccessLog" (
    "id"        TEXT NOT NULL,
    "schoolId"  TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "ip"        TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalAccessLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PortalAccessLog_schoolId_idx" ON "PortalAccessLog"("schoolId");
CREATE INDEX "PortalAccessLog_studentId_createdAt_idx" ON "PortalAccessLog"("studentId", "createdAt");
ALTER TABLE "PortalAccessLog" ADD CONSTRAINT "PortalAccessLog_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AuditLog: before/after row values
ALTER TABLE "AuditLog" ADD COLUMN "before" JSONB, ADD COLUMN "after" JSONB;
CREATE INDEX "AuditLog_schoolId_entityType_entityId_idx" ON "AuditLog"("schoolId", "entityType", "entityId");

-- Payment: private proof-of-payment key
ALTER TABLE "Payment" ADD COLUMN "popKey" TEXT;

-- TermResult: fair ranking
ALTER TABLE "TermResult"
  ADD COLUMN "subjectsSat"     INTEGER,
  ADD COLUMN "subjectsOffered" INTEGER,
  ADD COLUMN "rankedOutOf"     INTEGER;
