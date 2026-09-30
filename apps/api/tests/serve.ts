import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

// Every test file talks to its app through a server of its own, on the loopback address. Handed the app itself,
// supertest starts a server for each request, on every address and whatever port is free there. When another
// program on the machine holds that port on 127.0.0.1, the request reaches that program and fails with
// "socket hang up".
export async function serve(app: Express): Promise<Server> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

// Where fetch reaches the server. The live stream is read with fetch, because supertest cannot hold a stream open.
export const address = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// close() alone waits for every connection, and fetch can keep a spare one open after its stream has ended, so
// every connection is closed too. An open server would keep the test run from ending.
export async function stop(server: Server): Promise<void> {
  const closed = new Promise((done) => server.close(done));
  server.closeAllConnections();
  await closed;
}
