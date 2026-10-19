// Runs `prisma migrate deploy`, first clearing a previous failed attempt of a
// migration that is known to be all-or-nothing.
//
// Why: if a data migration stops (e.g. the Part 1 backfill finds a grade it
// cannot map), PostgreSQL rolls the whole migration back, but Prisma still
// records it as failed and refuses every later deploy until someone runs
// `prisma migrate resolve --rolled-back <name>` against the database. Doing
// that from Vercel's build means fixing the data and redeploying is enough.
//
// Only migrations listed in RETRYABLE are touched, and only when Prisma's own
// table says they failed (finished_at NULL, rolled_back_at NULL).
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const RETRYABLE = [
  '20261015090100_part1_backfill',
  '20261015090200_part1_constraints',
  '20261016010000_demo_data',
  '20261017000100_security_backfill',
  '20261017000200_security_rls_audit',
  '20261031000100_students_module_backfill',
  '20261031000200_students_module_constraints',
  '20261101000100_academics_module_backfill',
  '20261102000100_exams_core_backfill',
];

async function failedRetryableMigrations() {
  const prisma = new PrismaClient();
  try {
    const exists = await prisma.$queryRaw`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"`;
    if (!exists[0]?.exists) return [];
    const rows = await prisma.$queryRaw`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    return rows.map((r) => r.migration_name).filter((name) => RETRYABLE.includes(name));
  } finally {
    await prisma.$disconnect();
  }
}

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

for (const name of await failedRetryableMigrations()) {
  console.log(`Previous attempt of ${name} failed and was rolled back by PostgreSQL; marking it for retry.`);
  run(`npx prisma migrate resolve --rolled-back ${name}`);
}
run('npx prisma migrate deploy');

// Row-level security (migration 20261017000200) only protects anything if the
// application's database role is subject to it. Superusers and roles with
// BYPASSRLS skip every policy, so say so in the build log instead of failing
// silently. (Application-level scoping in lib/scoped-db.ts still applies.)
async function warnIfRoleBypassesRls() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT current_user AS "role", (rolsuper OR rolbypassrls) AS "bypasses"
      FROM pg_roles WHERE rolname = current_user`;
    if (rows[0]?.bypasses) {
      console.warn(
        `\n!! WARNING: database role "${rows[0].role}" is a superuser or has BYPASSRLS, so the row-level ` +
          'security policies do not apply to the app. Connect with a normal role (NOSUPERUSER NOBYPASSRLS) ' +
          'to get the second layer of school isolation.\n',
      );
    } else {
      console.log(`Row-level security applies to database role "${rows[0]?.role}".`);
    }
  } catch (err) {
    console.warn('Could not check whether the database role bypasses row-level security:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}
await warnIfRoleBypassesRls();
