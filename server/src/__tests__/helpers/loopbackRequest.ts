// Shared supertest entry point for the route suites.
//
// `supertest(app)` listens on an ephemeral port on ALL interfaces and then
// requests http://127.0.0.1:<port>. On macOS a foreign process that happens
// to hold the same port on 127.0.0.1 (a more specific bind than the
// wildcard one) wins, so a suite can be answered by a stranger (stray 404 /
// 401 / SSH banner). This helper instead runs ONE server per test file,
// bound to 127.0.0.1 only, and points supertest at its URL.
//
// Drop-in usage: replace `import request from 'supertest'` with
// `import request from './helpers/loopbackRequest'`; call sites such as
// `request(app).get('/x')` stay unchanged. The first import in a test file
// registers the listen/close hooks (beforeAll/afterAll) for that file, so
// requests may only be issued from inside tests or hooks.
//
// Several apps can be in flight at once (suites build a fresh express app
// per test, and some fire requests at two apps concurrently): each app is
// served under its own path prefix and the prefix is stripped before the
// app sees the request, so no per-request handler swapping is needed.

import http from 'http';
import type { AddressInfo } from 'net';
import supertest from 'supertest';

export type LoopbackApp = http.RequestListener;

const PREFIX = '/__loopback/';

const apps: LoopbackApp[] = [];
let server: http.Server | undefined;
let baseUrl: string | undefined;

function dispatch(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '';
  if (url.startsWith(PREFIX)) {
    const slash = url.indexOf('/', PREFIX.length);
    const id = Number(url.slice(PREFIX.length, slash === -1 ? undefined : slash));
    const target = apps[id];
    if (target) {
      req.url = slash === -1 ? '/' : url.slice(slash);
      target(req, res);
      return;
    }
  }
  res.statusCode = 502;
  res.end('loopbackRequest: no app registered for this path');
}

beforeAll(async () => {
  server = http.createServer(dispatch);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  if (addr.address !== '127.0.0.1') {
    throw new Error(`loopbackRequest: server bound to ${addr.address}, expected 127.0.0.1`);
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  const s = server;
  server = undefined;
  baseUrl = undefined;
  apps.length = 0;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>(resolve => s.close(() => resolve()));
});

/** Same call shape as `supertest(app)`, served via the 127.0.0.1-bound server. */
export default function request(app: LoopbackApp): ReturnType<typeof supertest> {
  if (!baseUrl) {
    throw new Error('loopbackRequest: server not listening yet; call request(app) inside a test or hook');
  }
  let id = apps.indexOf(app);
  if (id === -1) id = apps.push(app) - 1;
  return supertest(`${baseUrl}${PREFIX}${id}`);
}
