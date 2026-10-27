// Writes the access-seed migration from prisma/seed/access.ts:
//   npx ts-node --project tsconfig.seed.json prisma/seed/write-access-migration.ts prisma/migrations/<folder>
// With no folder it prints the SQL.
import fs from 'node:fs';
import path from 'node:path';
import { accessMigrationSql } from './access';

const dir = process.argv[2];
if (!dir) {
  process.stdout.write(accessMigrationSql());
} else {
  const target = path.resolve(dir);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'migration.sql'), accessMigrationSql());
  process.stdout.write(`Wrote ${path.join(target, 'migration.sql')}
`);
}
