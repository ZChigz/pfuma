-- Assets data step: the first asset register (categories, assets, transfers, maintenance, disposals) is copied into the Facilities register so
-- no school loses an asset or its history. Running it again changes nothing (an asset remembers which old asset it came from).
--   * a category keeps its name; the usual lives are filled in (ICT 3 years, furniture 10 ...) and can be changed;
--   * an asset keeps its tag number, cost in cents, dates and place; Excellent becomes New, Condemned becomes Poor, Active becomes In use,
--     Under maintenance becomes Under repair; one marked Disposed with no disposal record is kept In storage so it is not lost from sight; the custodian becomes the staff record of the same user when there is one;
--   * every transfer, every maintenance entry (as finished work) and every disposal is copied. A disposal was approved by the person who
--     recorded it, because that is all the old register knew.

INSERT INTO "FacAssetCategory" ("id", "schoolId", "name", "depreciationYears", "updatedAt")
SELECT gen_random_uuid()::text, c."schoolId", c."name",
       CASE lower(c."name") WHEN 'ict' THEN 3 WHEN 'furniture' THEN 10 WHEN 'laboratory' THEN 10 WHEN 'kitchen' THEN 8 WHEN 'vehicles' THEN 5 WHEN 'sports' THEN 5 WHEN 'agriculture' THEN 8 ELSE NULL END,
       CURRENT_TIMESTAMP
  FROM (SELECT DISTINCT "schoolId", "name" FROM "AssetCategory") c
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "FacAsset" ("id", "schoolId", "tag", "name", "categoryId", "location", "custodianId", "costCents", "currency", "purchasedAt", "condition", "status", "notes", "legacyAssetId", "updatedAt")
SELECT gen_random_uuid()::text, a."schoolId", a."tagNumber", a."name", fc."id", a."location",
       (SELECT e."id" FROM "Employee" e WHERE e."userId" = a."custodianId" AND e."schoolId" = a."schoolId"),
       round(a."acquisitionCost" * 100)::int, a."currency", a."acquisitionDate",
       CASE a."condition"::text WHEN 'EXCELLENT' THEN 'NEW' WHEN 'GOOD' THEN 'GOOD' WHEN 'FAIR' THEN 'FAIR' ELSE 'POOR' END::"FacAssetCondition",
       CASE a."status"::text WHEN 'ACTIVE' THEN 'IN_USE' WHEN 'UNDER_MAINTENANCE' THEN 'UNDER_REPAIR'
         ELSE CASE WHEN EXISTS (SELECT 1 FROM "AssetDisposal" d WHERE d."assetId" = a."id") THEN 'DISPOSED' ELSE 'IN_STORAGE' END END::"FacAssetStatus",
       NULLIF(btrim(concat_ws('. ', a."description", CASE WHEN a."custodian" IS NOT NULL AND a."custodianId" IS NULL THEN 'Custodian: ' || a."custodian" END, CASE WHEN a."imageUrl" IS NOT NULL THEN 'Photo: ' || a."imageUrl" END)), ''),
       a."id", CURRENT_TIMESTAMP
  FROM "Asset" a
  JOIN "AssetCategory" lc ON lc."id" = a."categoryId"
  JOIN "FacAssetCategory" fc ON fc."schoolId" = lc."schoolId" AND fc."name" = lc."name"
 WHERE NOT EXISTS (SELECT 1 FROM "FacAsset" x WHERE x."legacyAssetId" = a."id")
   AND NOT EXISTS (SELECT 1 FROM "FacAsset" y WHERE y."schoolId" = a."schoolId" AND y."tag" = a."tagNumber");

-- The tag counter carries on after the highest AST number.
INSERT INTO "FacSequence" ("id", "schoolId", "key", "nextNumber", "updatedAt")
SELECT gen_random_uuid()::text, "schoolId", 'AST', max(substring("tag" FROM '^AST-([0-9]+)$')::int) + 1, CURRENT_TIMESTAMP
  FROM "FacAsset" WHERE "tag" ~ '^AST-[0-9]+$' GROUP BY "schoolId"
ON CONFLICT ("schoolId", "key") DO UPDATE SET "nextNumber" = GREATEST("FacSequence"."nextNumber", EXCLUDED."nextNumber");

INSERT INTO "FacAssetTransfer" ("id", "schoolId", "assetId", "fromLocation", "toLocation", "fromCustodianId", "toCustodianId", "date", "recordedById", "confirmedAt", "confirmedById", "updatedAt")
SELECT gen_random_uuid()::text, t."schoolId", fa."id", t."fromLocation", t."toLocation",
       (SELECT e."id" FROM "Employee" e WHERE e."userId" = t."fromCustodianId" AND e."schoolId" = t."schoolId"),
       (SELECT e."id" FROM "Employee" e WHERE e."userId" = t."toCustodianId" AND e."schoolId" = t."schoolId"),
       t."transferDate", t."recordedById", t."transferDate", t."recordedById", CURRENT_TIMESTAMP
  FROM "AssetTransfer" t
  JOIN "FacAsset" fa ON fa."legacyAssetId" = t."assetId"
 WHERE (t."fromLocation" <> t."toLocation"
        OR (SELECT e."id" FROM "Employee" e WHERE e."userId" = t."fromCustodianId" AND e."schoolId" = t."schoolId") IS DISTINCT FROM (SELECT e."id" FROM "Employee" e WHERE e."userId" = t."toCustodianId" AND e."schoolId" = t."schoolId"))
   AND NOT EXISTS (SELECT 1 FROM "FacAssetTransfer" x WHERE x."assetId" = fa."id" AND x."date" = t."transferDate" AND x."fromLocation" = t."fromLocation" AND x."toLocation" = t."toLocation");

INSERT INTO "FacMaintenanceJob" ("id", "schoolId", "assetId", "problem", "reportedById", "status", "workDone", "provider", "costCents", "currency", "doneAt", "nextServiceDate", "updatedAt")
SELECT gen_random_uuid()::text, m."schoolId", fa."id", m."description", m."recordedBy", 'DONE',
       CASE WHEN char_length(btrim(m."description")) >= 3 THEN m."description" ELSE m."description" || ' (maintenance)' END, m."provider",
       CASE WHEN m."cost" IS NULL OR m."currency" IS NULL THEN NULL ELSE round(m."cost" * 100)::int END,
       CASE WHEN m."cost" IS NULL OR m."currency" IS NULL THEN NULL ELSE m."currency" END,
       m."maintenanceDate", m."nextServiceDate", CURRENT_TIMESTAMP
  FROM "AssetMaintenance" m
  JOIN "FacAsset" fa ON fa."legacyAssetId" = m."assetId"
 WHERE char_length(btrim(m."description")) >= 1
   AND NOT EXISTS (SELECT 1 FROM "FacMaintenanceJob" x WHERE x."assetId" = fa."id" AND x."doneAt" = m."maintenanceDate" AND x."problem" = m."description");

-- Past disposals were approved before the school had a value limit: the limit check is for new ones.
ALTER TABLE "FacAssetDisposal" DISABLE TRIGGER "guard_FacAssetDisposal";
INSERT INTO "FacAssetDisposal" ("id", "schoolId", "assetId", "method", "reason", "date", "proceedsCents", "currency", "headApprovedById", "recordedById", "updatedAt")
SELECT gen_random_uuid()::text, d."schoolId", fa."id", d."method"::text::"FacDisposalMethod",
       CASE WHEN char_length(btrim(d."reason")) >= 3 THEN d."reason" ELSE d."reason" || ' (disposed)' END, d."disposalDate",
       CASE WHEN d."proceeds" IS NULL OR d."currency" IS NULL THEN NULL ELSE round(d."proceeds" * 100)::int END,
       CASE WHEN d."proceeds" IS NULL OR d."currency" IS NULL THEN NULL ELSE d."currency" END,
       d."recordedBy", d."recordedBy", CURRENT_TIMESTAMP
  FROM "AssetDisposal" d
  JOIN "FacAsset" fa ON fa."legacyAssetId" = d."assetId"
 WHERE NOT EXISTS (SELECT 1 FROM "FacAssetDisposal" x WHERE x."assetId" = fa."id");
ALTER TABLE "FacAssetDisposal" ENABLE TRIGGER "guard_FacAssetDisposal";
