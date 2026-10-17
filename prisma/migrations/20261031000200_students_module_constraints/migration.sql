-- Student Information module — step 3 of 3 (constraints).
-- A phone number belongs to one guardian per school; the previous migration merged the duplicates, so this
-- stops a second record from ever being made. Siblings share the guardian record instead.
CREATE UNIQUE INDEX "Guardian_schoolId_phone_key" ON "Guardian"("schoolId", "phone");
