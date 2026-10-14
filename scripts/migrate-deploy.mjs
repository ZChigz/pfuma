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
