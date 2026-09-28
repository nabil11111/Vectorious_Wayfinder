import { createApp } from './app';
import { pool } from './db/client';
import { config } from './lib/config';
import { logger } from './lib/logger';

const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'));

// Finish in-flight requests and close the pool when Docker or Railway stops the container.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => void pool.end().then(() => process.exit(0)));
  });
}
