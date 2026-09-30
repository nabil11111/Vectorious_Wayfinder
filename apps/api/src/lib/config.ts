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
  // On, the app runs on its own clock and seeds one delivery day (spec 008). Off, it is the real clock and no
  // seeded day. The booklet's calendar ends on 28 Jun 2026, so the competition build runs with it on.
  DEMO_MODE: z.stringbool().default(true),
  // The live stream to open screens: how often a quiet stream gets a heartbeat, and how many may be open at
  // once. Both are settings so tests can make them small.
  LIVE_HEARTBEAT_MS: z.coerce.number().int().positive().default(20_000),
  LIVE_MAX_STREAMS: z.coerce.number().int().positive().default(200),
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export const config = Env.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
