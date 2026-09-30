import { createApp } from './app';
import { pool } from './db/client';
import { initClock } from './lib/clock';
import { config } from './lib/config';
import { closeStreams } from './lib/live';
import { logger } from './lib/logger';

// The clock is read from the database once, before the first request can ask for the time.
await initClock();

const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT }, 'api listening'));

// Finish in-flight requests and close the pool when Docker or Railway stops the container. The live streams
// are ended first: they never finish by themselves, so they would hold the server open.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    closeStreams();
    server.close(() => void pool.end().then(() => process.exit(0)));
    // close() waits for every connection, and one that is open but has sent nothing, or a stream that opened
    // a moment too late, would hold it for a minute or more. Requests in flight get a few seconds, then
    // whatever is left is cut.
    setTimeout(() => {
      closeStreams();
      server.closeAllConnections();
    }, 5_000).unref();
  });
}
