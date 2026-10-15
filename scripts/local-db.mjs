// Starts an embedded PostgreSQL server for local development (no Docker needed).
// Data lives in ./.local-db and survives restarts. Stop with Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('.local-db');
const port = Number(process.env.LOCAL_DB_PORT ?? 5433);
// Dev + test databases. Always UTF-8 (Windows would otherwise default to WIN1252 and reject
// characters such as "₹", "→" or non-Latin names).
const databases = ['attendance_local', 'attendance_local_test'];

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) {
  console.log('Initialising local PostgreSQL data directory…');
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const name of databases) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (rowCount) continue;
  // template0 + C locale lets us force UTF-8 regardless of the OS locale.
  await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  console.log(`Created database "${name}" (UTF-8)`);
}
await client.end();

console.log(`\nLocal PostgreSQL running on port ${port}`);
console.log(`DATABASE_URL=postgresql://postgres:postgres@localhost:${port}/attendance_local`);
console.log('Press Ctrl+C to stop.\n');

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
