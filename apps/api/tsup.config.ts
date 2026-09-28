import { defineConfig } from 'tsup';

// Bundles the server, the migrator and the seeder into dist/. The contracts package is TypeScript source,
// so it is bundled in; everything from node_modules stays external.
export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  noExternal: ['@wayfinder/contracts'],
});
