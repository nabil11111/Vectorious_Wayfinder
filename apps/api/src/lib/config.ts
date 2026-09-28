import { z } from 'zod';

// Read and check every setting once at startup, so a missing variable fails loudly instead of halfway through a request.
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SEED_PASSWORD: z.string().min(8).default('wayfinder-demo'),
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export const config = Env.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
