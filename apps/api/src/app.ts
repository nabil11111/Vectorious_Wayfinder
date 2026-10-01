import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { jsonOnlyWrites, loadUser, requireShownDepot } from './middleware/auth';
import { errorHandler, notFound } from './middleware/errors';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { clockRouter, demoClockRouter } from './routes/clock';
import { demoResetRouter } from './routes/demo-reset';
import { driverRouter } from './routes/driver';
import { eventsRouter } from './routes/events';
import { healthRouter } from './routes/health';
import { issuesRouter } from './routes/issues';
import { loadingRouter } from './routes/loading';
import { lookupRouter } from './routes/lookup';
import { meRouter } from './routes/me';
import { notificationsRouter } from './routes/notifications';
import { operationsRouter } from './routes/operations';
import { plansRouter } from './routes/plans';
import { storeRouter } from './routes/store';

// Builds the app without listening, so tests can drive it directly.
export function createApp() {
  const app = express();
  // Rate limits count by client address. Believe a forwarded address only when a proxy we run sits in front,
  // otherwise anyone could change the header on each try and never be limited.
  app.set('trust proxy', config.TRUST_PROXY);
  // docker compose serves the app over plain http on localhost, where telling the browser to upgrade every request
  // to https would break the page. Hosted, every request is https already, so the upgrade adds nothing there.
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  // Log the method, path, status and time only. Full headers would write session cookies into the logs. The
  // health check and the live stream are left out: one is polled all day, the other is one long request.
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/events' },
    serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
  }));
  // A receipt can name every line a stop can hold, 6,000 lines of about 390 KB, and carry a photo of up to 700,000
  // characters, so its route alone takes 2 MB (spec 015). The parser that reads a body first is the one that counts, and
  // every other route keeps 1 MB.
  app.use('/api/v1/store/receipts', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  // The live stream stays open for as long as a screen does, so it does not count as a request here.
  api.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, validate: { xForwardedForHeader: false },
    skip: (req) => req.path === '/events',
    message: { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } } }));
  api.use(jsonOnlyWrites);
  api.use(loadUser);
  api.use(requireShownDepot);
  api.use('/health', healthRouter);
  api.use('/auth', authRouter);
  api.use('/me', meRouter);
  api.use('/admin', adminRouter);
  api.use('/clock', clockRouter);
  api.use('/events', eventsRouter);
  api.use('/store', storeRouter);
  api.use('/plans', plansRouter);
  api.use('/loading', loadingRouter);
  api.use('/operations', operationsRouter);
  api.use('/lookup', lookupRouter);
  api.use('/driver', driverRouter);
  api.use('/issues', issuesRouter);
  api.use('/notifications', notificationsRouter);
  // The demo control exists only in demo mode. With it off these addresses answer 404 like any unknown one.
  if (config.DEMO_MODE) {
    api.use('/demo/clock', demoClockRouter);
    api.use('/demo/reset', demoResetRouter);
  }
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
