// Unit tests for the shared loopback helper's path-prefix routing.
import type { IncomingMessage, ServerResponse } from 'http';
import supertest from 'supertest';
import request from './helpers/loopbackRequest';

function echoApp(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ url: req.url }));
}

describe('loopbackRequest prefix routing', () => {
  it('serves a bare-prefix request that only has a query string', async () => {
    const res = await request(echoApp).get('?x=1&y=2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: '/?x=1&y=2' });
  });

  it('keeps the path and query for a normal request', async () => {
    const res = await request(echoApp).get('/a/b?x=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: '/a/b?x=1' });
  });

  it('serves a bare prefix with no path at all as /', async () => {
    const res = await request(echoApp).get('');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: '/' });
  });

  it.each([
    ['a non-numeric id', '/__loopback/x/a'],
    ['an empty id', '/__loopback//a'],
    ['a hex-looking id that Number() would accept', '/__loopback/0x0/a'],
  ])('answers 502 for %s instead of routing to app 0', async (_label, path) => {
    // Registers echoApp as app 0 and reveals the server origin.
    const first = await request(echoApp).get('/ok');
    expect(first.body).toEqual({ url: '/ok' });
    const origin = new URL(first.request.url).origin;
    const res = await supertest(origin).get(path);
    expect(res.status).toBe(502);
  });
});
