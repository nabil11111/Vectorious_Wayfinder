import { defineConfig } from 'vitest/config';

// Tests run against a real Postgres (compose's db locally, a service container in CI), migrated and seeded first.
try { process.loadEnvFile('../../.env'); } catch { /* CI sets the variables itself */ }
process.env.NODE_ENV = 'test';

export default defineConfig({
  // The tests hit a real database, and on a busy laptop a request can take seconds. A generous limit keeps a
  // slow machine from reading as a failing test.
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
