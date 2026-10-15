import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Prepares the TEST database before the integration suite, without destroying anything:
 * applies pending migrations and runs the (idempotent) seed. Tests create their own uniquely
 * named employees per run, so repeated runs never collide.
 * Requires a running PostgreSQL (locally: `npm run db:local`; in CI: the postgres service).
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/attendance_local_test';
  if (!/test/i.test(url)) throw new Error(`Refusing to use a non-test database for tests: ${url}`);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: url,
    DIRECT_URL: url,
    SEED_DEMO_DATA: 'true',
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-1234567890',
    JOB_SECRET: 'test-job-secret-123456',
  };
  const cwd = path.resolve(import.meta.dirname, '..');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
