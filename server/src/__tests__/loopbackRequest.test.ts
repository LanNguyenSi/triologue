// Unit tests for the shared loopback helper's path-prefix routing.
import type { IncomingMessage, ServerResponse } from 'http';
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
    expect(res.body).toEqual({ url: '/' });
  });
});
