-- Sick bay data step: the visits recorded on the Medical tab are copied into the sick bay so no school loses a visit. Running it again changes
-- nothing (a visit remembers which old visit it came from).
--   * the complaint becomes the nearest one on the new list (headache, fever, stomach pain, injury, menstrual, asthma); anything else is
--     Other, with the old words kept as the note;
--   * Returned to class becomes Back to class; Sent home and Sent to clinic stay as they were;
--   * an old visit has no referral details and no time the guardian was told, so those stay empty. The rules that ask for them apply to
--     visits recorded from now on, which is why the guard is switched off for this copy only.
ALTER TABLE "FacSickBayVisit" DISABLE TRIGGER "guard_FacSickBayVisit";

INSERT INTO "FacSickBayVisit" ("id", "schoolId", "studentId", "visitedAt", "complaint", "complaintNote", "treatment", "outcome", "guardianInformedAt", "guardianInformedMethod", "recordedById", "legacyVisitId", "updatedAt")
SELECT gen_random_uuid()::text, v."schoolId", v."studentId", v."visitedAt",
       CASE
         WHEN v."complaint" ~* 'head' THEN 'HEADACHE' WHEN v."complaint" ~* 'fever|temperature' THEN 'FEVER'
         WHEN v."complaint" ~* 'stomach|tummy|abdom' THEN 'STOMACH_PAIN' WHEN v."complaint" ~* 'injur|cut|wound|sprain|fall' THEN 'INJURY'
         WHEN v."complaint" ~* 'menstru|period|cramp' THEN 'MENSTRUAL' WHEN v."complaint" ~* 'asthma|wheez|breath' THEN 'ASTHMA' ELSE 'OTHER' END::"FacComplaint",
       left(v."complaint", 300), v."treatment",
       CASE v."outcome"::text WHEN 'RETURNED_TO_CLASS' THEN 'BACK_TO_CLASS' WHEN 'SENT_HOME' THEN 'SENT_HOME' ELSE 'SENT_TO_CLINIC' END::"FacVisitOutcome",
       CASE WHEN v."guardianInformed" THEN v."visitedAt" END, CASE WHEN v."guardianInformed" THEN 'Recorded before the sick bay module' END,
       v."recordedById", v."id", CURRENT_TIMESTAMP
  FROM "SickBayVisit" v
 WHERE NOT EXISTS (SELECT 1 FROM "FacSickBayVisit" x WHERE x."legacyVisitId" = v."id");

ALTER TABLE "FacSickBayVisit" ENABLE TRIGGER "guard_FacSickBayVisit";
