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
// A server error raised after listen() succeeded; surfaced by request() and afterAll.
let serverError: Error | undefined;

function dispatch(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? '';
  if (url.startsWith(PREFIX)) {
    // The id ends at the next '/' or '?' (a bare-prefix request such as
    // `/__loopback/0?x=1` has no slash before its query string).
    const rest = url.slice(PREFIX.length);
    const end = rest.search(/[/?]/);
    const idText = end === -1 ? rest : rest.slice(0, end);
    const target = /^\d+$/.test(idText) ? apps[Number(idText)] : undefined;
    if (target) {
      const tail = end === -1 ? '' : rest.slice(end);
      req.url = tail === '' ? '/' : tail.startsWith('?') ? `/${tail}` : tail;
      target(req, res);
      return;
    }
  }
  res.statusCode = 502;
  res.end('loopbackRequest: no app registered for this path');
}

beforeAll(async () => {
  server = http.createServer(dispatch);
  const s = server;
  await new Promise<void>((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      // Startup errors are handled; drop that listener so it is not left
      // attached, and record any later error instead of swallowing it.
      s.removeListener('error', reject);
      s.on('error', err => {
        serverError = err;
      });
      resolve();
    });
  });
  const addr = server.address() as AddressInfo;
  if (addr.address !== '127.0.0.1') {
    throw new Error(`loopbackRequest: server bound to ${addr.address}, expected 127.0.0.1`);
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  const s = server;
  const err = serverError;
  server = undefined;
  baseUrl = undefined;
  serverError = undefined;
  apps.length = 0;
  if (s) {
    s.closeAllConnections();
    await new Promise<void>(resolve => s.close(() => resolve()));
  }
  if (err) throw new Error(`loopbackRequest: server error after listen: ${err.message}`);
});

/** Same call shape as `supertest(app)`, served via the 127.0.0.1-bound server. */
export default function request(app: LoopbackApp): ReturnType<typeof supertest> {
  if (!baseUrl) {
    throw new Error('loopbackRequest: server not listening yet; call request(app) inside a test or hook');
  }
  if (serverError) {
    throw new Error(`loopbackRequest: server error after listen: ${serverError.message}`);
  }
  let id = apps.indexOf(app);
  if (id === -1) id = apps.push(app) - 1;
  return supertest(`${baseUrl}${PREFIX}${id}`);
}
