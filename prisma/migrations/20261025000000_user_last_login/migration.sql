-- Dashboard staff card: "how many logged in this week".
-- Nullable; existing users stay NULL until their next sign-in, so the count starts at
-- zero and fills in over the first week. Nothing is guessed or backfilled.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);
CREATE INDEX "User_schoolId_lastLoginAt_idx" ON "User"("schoolId", "lastLoginAt");
