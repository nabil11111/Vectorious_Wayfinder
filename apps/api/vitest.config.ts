import { defineConfig } from 'vitest/config';

// Tests run against a real Postgres (compose's db locally, a service container in CI), migrated and seeded first.
try { process.loadEnvFile('../../.env'); } catch { /* CI sets the variables itself */ }
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], fileParallelism: false },
});
