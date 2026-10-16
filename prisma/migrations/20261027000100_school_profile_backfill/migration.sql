-- Data migration for the school profile. Idempotent; nothing is deleted.
--  * district        <- the old "location" (it was labelled "Town or district")
--  * physicalAddress <- the old "address"
--  * phone           -> the +263… form when it can be read as a Zimbabwe number; anything
--                       that cannot is left exactly as it was.
UPDATE "School" SET "district" = btrim("location")
 WHERE "district" IS NULL AND "location" IS NOT NULL AND btrim("location") <> '';

UPDATE "School" SET "physicalAddress" = btrim("address")
 WHERE "physicalAddress" IS NULL AND "address" IS NOT NULL AND btrim("address") <> '';

WITH digits AS (
  SELECT "id", regexp_replace("phone", '[^0-9+]', '', 'g') AS d FROM "School" WHERE "phone" IS NOT NULL
), fixed AS (
  SELECT "id",
         CASE
           WHEN d ~ '^\+263[0-9]{8,10}$' THEN d
           WHEN d ~ '^263[0-9]{8,10}$'   THEN '+' || d
           WHEN d ~ '^0[0-9]{8,10}$'     THEN '+263' || substr(d, 2)
           ELSE NULL
         END AS p
    FROM digits
)
UPDATE "School" s SET "phone" = f.p FROM fixed f WHERE s."id" = f."id" AND f.p IS NOT NULL;

-- Rules the database keeps even if a bug skips the form. There is deliberately no check on the
-- phone column: a school whose old free-text phone could not be read keeps it, and a check
-- would stop every other update to that school (class size, library settings...) until the
-- phone was fixed. The profile form and API always store phones as +263… (lib/phone.ts).
ALTER TABLE "School"
  ADD CONSTRAINT "School_province_known" CHECK ("province" IS NULL OR "province" IN (
    'Bulawayo', 'Harare', 'Manicaland', 'Mashonaland Central', 'Mashonaland East', 'Mashonaland West',
    'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands')) NOT VALID,
  ADD CONSTRAINT "School_website_format" CHECK ("website" IS NULL OR "website" ~ '^https?://[^ ]+$') NOT VALID,
  ADD CONSTRAINT "School_name_not_blank" CHECK (btrim("name") <> '') NOT VALID;
