// Covers the helper's handling of a server error that arrives after listen().
// The helper registers its beforeAll/afterAll hooks at import time, so the
// server is captured by wrapping http.createServer and the afterAll callback
// is captured (instead of registered) so the test can run it and observe the
// throw without failing this suite's own teardown.
import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

const servers: http.Server[] = [];
const realCreateServer = http.createServer.bind(http);
jest.spyOn(http, 'createServer').mockImplementation(((...args: unknown[]) => {
  const s = (realCreateServer as (...a: unknown[]) => http.Server)(...args);
  servers.push(s);
  return s;
}) as typeof http.createServer);

const captured: Array<() => Promise<void> | void> = [];
const realAfterAll = global.afterAll;
(global as unknown as { afterAll: unknown }).afterAll = (fn: () => Promise<void> | void) => {
  captured.push(fn);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('./helpers/loopbackRequest').default as typeof import('./helpers/loopbackRequest').default;
(global as unknown as { afterAll: unknown }).afterAll = realAfterAll;

function app(_req: IncomingMessage, res: ServerResponse): void {
  res.end('ok');
}

describe('loopbackRequest late server errors', () => {
  it('keeps exactly one error listener after listen and records a later error', () => {
    expect(servers).toHaveLength(1);
    const s = servers[0];
    expect(s.listenerCount('error')).toBe(1);
    expect(() => request(app)).not.toThrow();
    s.emit('error', new Error('late boom'));
    expect(() => request(app)).toThrow(/server error after listen: late boom/);
  });

  it('rethrows the recorded error from afterAll after closing the server', async () => {
    expect(captured).toHaveLength(1);
    await expect(Promise.resolve(captured[0]())).rejects.toThrow(/server error after listen: late boom/);
    expect(servers[0].listening).toBe(false);
  });
});
