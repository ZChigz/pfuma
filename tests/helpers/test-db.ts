// Real PostgreSQL (PGlite) with every schema migration applied, reachable by the
// normal Prisma client through a local socket. The app connects as a plain role
// (not a superuser) so row-level security really applies.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// Data-only migrations for the live site; they add nothing to the schema.
const SKIP = /wipe_data|demo_data/;
const MIGRATIONS = path.resolve(__dirname, '../../prisma/migrations');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface TestDb {
  pg: PGlite;
  stop: () => Promise<void>;
}

/** Applies migrations up to (and excluding) `stopBefore`, if given. */
export async function createPg(stopBefore?: string, opts: { includeData?: boolean } = {}): Promise<PGlite> {
  const pg = await PGlite.create();
  const dirs = fs.readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort().filter((d) => opts.includeData || !SKIP.test(d));
  for (const dir of dirs) {
    if (stopBefore && dir >= stopBefore) break;
    await pg.exec(fs.readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8'));
  }
  return pg;
}

export async function applyMigration(pg: PGlite, name: string) {
  await pg.exec(fs.readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8'));
}

/** Starts the database and points DATABASE_URL at it. Call before importing lib/prisma. */
export async function startTestDb(): Promise<TestDb> {
  const pg = await createPg();
  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;
    GRANT USAGE ON SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  const port = await freePort();
  const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&sslmode=disable`;
  return {
    pg,
    stop: async () => {
      await server.stop();
      await pg.close();
    },
  };
}
