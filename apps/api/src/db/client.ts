import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../lib/config';
import * as schema from './schema';

// One pool for the whole process. Everything that talks to the database goes through `db`.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
// What a function takes when it must run inside its caller's transaction.
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
