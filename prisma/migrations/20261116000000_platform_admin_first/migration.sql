-- The first Pfuma console account (/platform/login). The live database is only reachable through a
-- deploy, so scripts/create-platform-admin.mjs cannot be run against it; this does the same once.
-- Only the bcrypt hash (12 rounds) is stored. Does nothing if the email already exists.
INSERT INTO "PlatformAdmin" ("id", "email", "fullName", "passwordHash", "active", "tokenVersion", "createdAt", "updatedAt")
VALUES (
  'platform_admin_first',
  'chigudu@pfuma.co.zw',
  'Zvikomborero Chigudugudze',
  '$2b$12$FRWFdJZSkhoMcYgUO6uFoOmS075Jbk3/jbCjTpfBkbnAJxBJCMxK.',
  true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO NOTHING;
