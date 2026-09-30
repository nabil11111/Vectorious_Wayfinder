import { z } from 'zod';

// Read and check every setting once at startup, so a missing variable fails loudly instead of halfway through a request.
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SEED_PASSWORD: z.string().min(8).default('wayfinder-demo'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('wayfinder-admin'),
  // How many proxies sit in front of the app. 0 when it is reached directly (compose), 1 on Railway.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export const config = Env.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
