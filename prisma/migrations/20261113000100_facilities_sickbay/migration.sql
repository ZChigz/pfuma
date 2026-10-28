-- Sick bay rules the database holds whatever the code does:
--   * a learner kept to rest has an admission time; one sent to a clinic has a referral (where, how, who goes with them);
--     one sent home has the guardian told (the time is kept);
--   * a discharge time, once set, is not changed, and a visit's complaint and outcome are not rewritten afterwards;
--   * a dose is ticked by a person, and a medicine is on a round only once per learner and time;
--   * the sick bay is a place a learner can only be in once at a time.
CREATE OR REPLACE FUNCTION fac_sickbay_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."outcome" = 'REST_IN_SICK_BAY' AND NEW."admittedAt" IS NULL THEN
    RAISE EXCEPTION 'A learner kept in the sick bay needs an admission time' USING ERRCODE = '23514';
  END IF;
  IF NEW."outcome" = 'SENT_TO_CLINIC' AND (
       NEW."referral" IS NULL
       OR char_length(btrim(coalesce(NEW."referral"->>'facility', ''))) < 2
       OR char_length(btrim(coalesce(NEW."referral"->>'transport', ''))) < 2
       OR char_length(btrim(coalesce(NEW."referral"->>'accompaniedBy', ''))) < 2) THEN
    RAISE EXCEPTION 'A learner sent to a clinic needs the clinic, the transport and who goes with them' USING ERRCODE = '23514';
  END IF;
  IF NEW."outcome" = 'SENT_HOME' AND NEW."guardianInformedAt" IS NULL THEN
    RAISE EXCEPTION 'Tell the guardian before a learner is sent home' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."dischargedAt" IS NOT NULL AND NEW."dischargedAt" IS DISTINCT FROM OLD."dischargedAt" THEN
      RAISE EXCEPTION 'A discharge time cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF NEW."complaint" <> OLD."complaint" OR NEW."outcome" <> OLD."outcome" OR NEW."studentId" <> OLD."studentId" OR NEW."visitedAt" <> OLD."visitedAt" THEN
      RAISE EXCEPTION 'A sick bay visit is not rewritten. Record a new visit instead.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "guard_FacSickBayVisit" BEFORE INSERT OR UPDATE ON "FacSickBayVisit" FOR EACH ROW EXECUTE FUNCTION fac_sickbay_guard();

-- One open admission per learner.
CREATE UNIQUE INDEX "FacSickBayVisit_one_admitted" ON "FacSickBayVisit"("studentId") WHERE "admittedAt" IS NOT NULL AND "dischargedAt" IS NULL;

ALTER TABLE "FacMedicationDose" ADD CONSTRAINT "FacMedicationDose_given" CHECK (("givenAt" IS NULL) = ("givenById" IS NULL) AND NOT ("givenAt" IS NOT NULL AND "missed"));
CREATE UNIQUE INDEX "FacMedicationDose_once" ON "FacMedicationDose"("roundId", "studentId", "medicine", "dueTime");
