-- Library data step: the books, copies, members and loans of the first library tables are copied into the Facilities library, so no
-- school loses its catalogue or its open loans. Running it again changes nothing (every copied row remembers where it came from).
--   * a book becomes a title with one author, its replacement cost in cents;
--   * a copy keeps its accession number (also its barcode); condition Fair becomes Worn; Borrowed becomes On loan; a copy that was
--     marked Damaged is Withdrawn with condition Damaged;
--   * a student member becomes a learner member; a staff member becomes a staff member when they have a staff record;
--   * every loan is copied with its fine in cents. A fine that was still unpaid stays on the older library screens; it is NOT raised
--     again as a new charge, so nobody is charged twice.

INSERT INTO "FacBookTitle" ("id", "schoolId", "title", "authors", "isbn", "publisher", "year", "subject", "shelfLocation", "coverKey", "lendable", "replacementCents", "currency", "legacyBookId", "category", "updatedAt")
SELECT gen_random_uuid()::text, b."schoolId", b."title", ARRAY[b."author"], b."isbn", b."publisher", b."year", b."subject", b."shelfLocation", NULL, true,
       CASE WHEN b."replacementCost" IS NULL THEN NULL ELSE round(b."replacementCost" * 100)::int END,
       CASE WHEN b."replacementCost" IS NULL THEN NULL ELSE b."replacementCurrency" END,
       b."id", 'FICTION', CURRENT_TIMESTAMP
  FROM "Book" b
 WHERE NOT EXISTS (SELECT 1 FROM "FacBookTitle" t WHERE t."legacyBookId" = b."id");

INSERT INTO "FacBookCopy" ("id", "schoolId", "titleId", "accessionNo", "barcode", "condition", "status", "source", "costCents", "currency", "legacyCopyId", "updatedAt")
SELECT gen_random_uuid()::text, c."schoolId", t."id", c."accessionNumber", c."accessionNumber",
       CASE c."condition"::text WHEN 'NEW' THEN 'NEW' WHEN 'GOOD' THEN 'GOOD' WHEN 'FAIR' THEN 'WORN' ELSE 'DAMAGED' END::"FacCopyCondition",
       CASE c."status"::text WHEN 'AVAILABLE' THEN 'AVAILABLE' WHEN 'BORROWED' THEN 'ON_LOAN' WHEN 'LOST' THEN 'LOST' ELSE 'WITHDRAWN' END::"FacCopyStatus",
       'BOUGHT', COALESCE(CASE WHEN b."replacementCost" IS NULL THEN NULL ELSE round(b."replacementCost" * 100)::int END, 0), COALESCE(b."replacementCurrency", 'USD'), c."id", CURRENT_TIMESTAMP
  FROM "BookCopy" c
  JOIN "Book" b ON b."id" = c."bookId"
  JOIN "FacBookTitle" t ON t."legacyBookId" = b."id"
 WHERE NOT EXISTS (SELECT 1 FROM "FacBookCopy" x WHERE x."legacyCopyId" = c."id")
   AND NOT EXISTS (SELECT 1 FROM "FacBookCopy" y WHERE y."schoolId" = c."schoolId" AND y."accessionNo" = c."accessionNumber");

-- The accession counter carries on after the highest number copied (ACC-00071 -> next 72); numbers of another shape are ignored.
INSERT INTO "FacSequence" ("id", "schoolId", "key", "nextNumber", "updatedAt")
SELECT gen_random_uuid()::text, "schoolId", 'ACC', max(substring("accessionNo" FROM '^ACC-([0-9]+)$')::int) + 1, CURRENT_TIMESTAMP
  FROM "FacBookCopy" WHERE "accessionNo" ~ '^ACC-[0-9]+$' GROUP BY "schoolId"
ON CONFLICT ("schoolId", "key") DO UPDATE SET "nextNumber" = GREATEST("FacSequence"."nextNumber", EXCLUDED."nextNumber");

INSERT INTO "FacLibraryMember" ("id", "schoolId", "type", "studentId", "employeeId", "suspended", "suspendedReason", "updatedAt")
SELECT gen_random_uuid()::text, m."schoolId", 'LEARNER'::"FacMemberType", m."studentId", NULL, m."borrowingSuspended", CASE WHEN m."borrowingSuspended" AND char_length(btrim(coalesce(m."suspensionReason", ''))) < 3 THEN 'Suspended before the library moved to Facilities' ELSE m."suspensionReason" END, CURRENT_TIMESTAMP
  FROM "LibraryMember" m
 WHERE m."studentId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "FacLibraryMember" x WHERE x."studentId" = m."studentId")
UNION ALL
SELECT gen_random_uuid()::text, m."schoolId", 'STAFF'::"FacMemberType", NULL, e."id", m."borrowingSuspended", CASE WHEN m."borrowingSuspended" AND char_length(btrim(coalesce(m."suspensionReason", ''))) < 3 THEN 'Suspended before the library moved to Facilities' ELSE m."suspensionReason" END, CURRENT_TIMESTAMP
  FROM "LibraryMember" m
  JOIN "Employee" e ON e."userId" = m."userId" AND e."schoolId" = m."schoolId"
 WHERE m."studentId" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "FacLibraryMember" x WHERE x."employeeId" = e."id");

INSERT INTO "FacLoan" ("id", "schoolId", "copyId", "memberId", "outAt", "dueAt", "returnedAt", "renewedCount", "conditionOnReturn", "fineCents", "fineCurrency", "checkedOutById", "updatedAt")
SELECT gen_random_uuid()::text, br."schoolId", fc."id", fm."id", br."checkoutDate", GREATEST(br."dueDate", br."checkoutDate" + interval '1 second'), CASE WHEN br."returnDate" IS NULL THEN NULL ELSE GREATEST(br."returnDate", br."checkoutDate") END, 0,
       CASE br."conditionOnReturn"::text WHEN 'NEW' THEN 'NEW' WHEN 'GOOD' THEN 'GOOD' WHEN 'FAIR' THEN 'WORN' WHEN 'DAMAGED' THEN 'DAMAGED' END::"FacCopyCondition",
       CASE WHEN br."returnDate" IS NULL THEN 0 ELSE round(br."fineAmount" * 100)::int END,
       CASE WHEN br."returnDate" IS NULL OR br."fineAmount" = 0 THEN NULL ELSE 'USD' END::"Currency",
       COALESCE((SELECT u."id" FROM "User" u WHERE u."schoolId" = br."schoolId" AND u."isSupport" = false ORDER BY u."createdAt" LIMIT 1), ''), CURRENT_TIMESTAMP
  FROM "Borrowing" br
  JOIN "FacBookCopy" fc ON fc."legacyCopyId" = br."copyId"
  JOIN "LibraryMember" lm ON lm."id" = br."memberId"
  JOIN "FacLibraryMember" fm ON (lm."studentId" IS NOT NULL AND fm."studentId" = lm."studentId")
                             OR (lm."studentId" IS NULL AND fm."employeeId" IN (SELECT e."id" FROM "Employee" e WHERE e."userId" = lm."userId"))
 WHERE EXISTS (SELECT 1 FROM "User" u WHERE u."schoolId" = br."schoolId" AND u."isSupport" = false)
   AND NOT EXISTS (SELECT 1 FROM "FacLoan" x WHERE x."copyId" = fc."id" AND x."memberId" = fm."id" AND x."outAt" = br."checkoutDate")
   -- only one open loan per copy (the database insists); an older open loan on a copy that has been lent since is skipped
   AND (br."returnDate" IS NOT NULL OR NOT EXISTS (SELECT 1 FROM "FacLoan" o WHERE o."copyId" = fc."id" AND o."returnedAt" IS NULL));
