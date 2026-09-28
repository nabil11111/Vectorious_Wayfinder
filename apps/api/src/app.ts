import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { jsonOnlyWrites, loadUser } from './middleware/auth';
import { errorHandler, notFound } from './middleware/errors';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';

// Builds the app without listening, so tests can drive it directly.
export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Railway sits in front; this makes rate limits see the real client address.
  app.use(helmet());
  // Log the method, path, status and time only. Full headers would write session cookies into the logs.
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } } }));
  api.use(jsonOnlyWrites);
  api.use(loadUser);
  api.use('/health', healthRouter);
  api.use('/auth', authRouter);
  api.use(notFound);
  app.use('/api/v1', api);

  // In production the same process serves the built web app, so there is one address and no CORS.
  const web = config.WEB_DIST;
  if (web && existsSync(web)) {
    app.use(express.static(web, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(web, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
