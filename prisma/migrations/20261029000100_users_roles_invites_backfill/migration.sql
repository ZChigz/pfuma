-- Data migration for the Users page. Idempotent; nobody loses access or changes meaning.
--  * Every existing user gets the staff role that matches the access level they already have
--    (ADMIN is a School Administrator, DIRECTOR an Owner, HEAD a Head Teacher, and so on).
--  * Existing users are not "invited": they already have a password, so they read as Active.
--  * Phone and title stay empty until someone fills them in.
UPDATE "User" SET "staffRoles" = ARRAY[staff_role_for("role")] WHERE cardinality("staffRoles") = 0;
