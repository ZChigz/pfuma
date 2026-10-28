-- Exeats: the rules the database keeps itself (no new tables).
--   * an exeat moves REQUESTED -> APPROVED or REJECTED or CANCELLED, APPROVED -> SIGNED_OUT or CANCELLED, SIGNED_OUT -> RETURNED, and no other way;
--   * a learner is signed out only when the person collecting is a guardian marked "can collect", or another adult whose name, ID number and phone
--     are recorded together with the primary guardian's confirmation (who confirmed, how, when);
--   * a learner is out on one exeat at a time.

CREATE OR REPLACE FUNCTION fac_exeat_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    IF NOT ((OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED', 'CANCELLED'))
         OR (OLD."status" = 'APPROVED'  AND NEW."status" IN ('SIGNED_OUT', 'CANCELLED'))
         OR (OLD."status" = 'SIGNED_OUT' AND NEW."status" = 'RETURNED')) THEN
      RAISE EXCEPTION 'An exeat cannot go from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW."status" = 'SIGNED_OUT' AND (TG_OP = 'INSERT' OR OLD."status" <> 'SIGNED_OUT') THEN
    c := NEW."collectedBy"::jsonb;
    IF c ->> 'kind' = 'GUARDIAN' THEN
      IF NOT EXISTS (SELECT 1 FROM "StudentGuardian" sg WHERE sg."studentId" = NEW."studentId" AND sg."guardianId" = c ->> 'guardianId' AND sg."canCollect") THEN
        RAISE EXCEPTION 'That guardian is not allowed to collect this learner. Another adult needs the primary guardian''s confirmation.' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF c ->> 'kind' = 'OTHER' THEN
      IF btrim(coalesce(c ->> 'name', '')) = '' OR btrim(coalesce(c ->> 'idNumber', '')) = '' OR btrim(coalesce(c ->> 'phone', '')) = ''
         OR (c ->> 'primaryConfirmedAt') IS NULL OR btrim(coalesce(c ->> 'primaryConfirmedBy', '')) = '' OR btrim(coalesce(c ->> 'confirmMethod', '')) = '' THEN
        RAISE EXCEPTION 'Someone who is not an authorised guardian needs their name, ID number and phone, and the primary guardian''s confirmation, before the learner leaves.' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'Say who is collecting the learner' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."signedOutAt" IS NULL OR NEW."signedOutById" IS NULL THEN
      RAISE EXCEPTION 'Sign-out needs the time and the person who signed the learner out' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "guard_FacExeat" BEFORE INSERT OR UPDATE ON "FacExeat" FOR EACH ROW EXECUTE FUNCTION fac_exeat_guard();

CREATE UNIQUE INDEX "FacExeat_one_out" ON "FacExeat"("studentId") WHERE "status" = 'SIGNED_OUT';
