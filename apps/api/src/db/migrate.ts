import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';
import { logger } from '../lib/logger';

// Applies committed SQL migrations in order. Safe to run on every start: applied ones are skipped.
const here = path.dirname(fileURLToPath(import.meta.url));
const folder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../../drizzle');

await migrate(db, { migrationsFolder: folder });
logger.info({ folder }, 'migrations applied');
await pool.end();
