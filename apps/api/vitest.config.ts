import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 120000,
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      // Integration tests hit a real PostgreSQL test database (reset + seeded once per run).
      { extends: true, test: { name: 'integration', include: ['test/**/*.test.ts'], globalSetup: ['test/global-setup.ts'] } },
    ],
  },
});
