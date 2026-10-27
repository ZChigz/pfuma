-- The switch: nobody sees everything by default any more. The Owner and the Administrator hold exactly the permissions listed for
-- them in the access seed (20261109000300 took their "*" rows away); this migration makes sure no role anywhere still holds the
-- wildcard, and stops one from being created.

-- Anyone whose role still carried "*" (a role the seed does not own) is told to refresh their permissions, then the row goes.
UPDATE "User" u SET "permVersion" = u."permVersion" + 1
 WHERE EXISTS (
   SELECT 1 FROM "UserRole" ur JOIN "RolePermission" rp ON rp."roleId" = ur."roleId"
    WHERE ur."userId" = u."id" AND rp."permissionKey" = '*'
 );

DELETE FROM "RolePermission" WHERE "permissionKey" = '*';

-- The database refuses the wildcard from now on, whatever the code does.
ALTER TABLE "RolePermission"
  ADD CONSTRAINT "RolePermission_no_wildcard" CHECK ("permissionKey" <> '*');
