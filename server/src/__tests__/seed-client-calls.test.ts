/**
 * Client-level `$` calls (raw SQL, transactions) and prisma/seed.ts.
 *
 * The fake Prisma client in helpers/fakePrismaClientPreload.js only saw model
 * methods before, so a seed that wrote a password through $executeRaw inside a
 * try/catch it swallows itself would still pass the ADMIN_PASSWORD guard tests.
 * Two layers close that:
 *
 *   1. The stand-in records every client `$` call (except the $connect and
 *      $disconnect lifecycle calls) as `FAKE_CLIENT_CALL <method>`; tested here
 *      against a tiny script that calls each method.
 *   2. A structural guard: prisma/seed.ts may use no client `$` method other
 *      than $connect/$disconnect. Chosen over asserting "no FAKE_CLIENT_CALL in
 *      a seed run" alone because a call behind a branch that no scenario takes
 *      (or behind a swallowed catch) never prints, while the source scan sees it.
 *      A seed run asserts the recorded side as well.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const SERVER_DIR = path.resolve(__dirname, '../..');
const TS_NODE_BIN = require.resolve('ts-node/dist/bin.js');
const PRELOAD = path.join(__dirname, 'helpers', 'fakePrismaClientPreload.js');
const SEED = path.join(SERVER_DIR, 'prisma', 'seed.ts');

let scratch: string;
beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-client-calls-'));
});
afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

const baseEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH, HOME: scratch, TMPDIR: scratch, TS_NODE_TRANSPILE_ONLY: '1' });

describe('fake client records client-level $ calls', () => {
  const METHODS = ['$executeRaw', '$executeRawUnsafe', '$queryRaw', '$queryRawUnsafe', '$transaction'];

  for (const method of METHODS) {
    it(`records ${method}, even when the caller swallows its own errors`, () => {
      const script = `
        const { PrismaClient } = require('@prisma/client');
        const c = new PrismaClient();
        (async () => {
          try { await c.${method}(${method.endsWith('Unsafe') ? "'UPDATE x SET y = 1'" : '[]'}); } catch (e) {}
          await c.$disconnect();
        })();`;
      const result = spawnSync(process.execPath, ['-r', PRELOAD, '-e', script], { cwd: scratch, env: baseEnv(), encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
      expect(result.status).toBe(0);
      expect(result.stdout.split('\n')).toContain(`FAKE_CLIENT_CALL ${method}`);
    });
  }

  it('records the model writes inside a $transaction callback and ignores the lifecycle calls', () => {
    const script = `
      const { PrismaClient } = require('@prisma/client');
      const c = new PrismaClient();
      (async () => {
        await c.$connect();
        await c.$transaction(async tx => { await tx.user.update({ where: { id: 'a' }, data: { isAdmin: true } }); });
        await c.$disconnect();
      })();`;
    const result = spawnSync(process.execPath, ['-r', PRELOAD, '-e', script], { cwd: scratch, env: baseEnv(), encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines).toContain('FAKE_CLIENT_CALL $transaction');
    expect(lines).toContain('FAKE_WRITE user.update');
    expect(lines.filter(l => l.startsWith('FAKE_CLIENT_CALL'))).toEqual(['FAKE_CLIENT_CALL $transaction']);
  });
});

describe('prisma/seed.ts uses no client-level $ method', () => {
  it('source: no `.$method` other than $connect and $disconnect', () => {
    const source = fs.readFileSync(SEED, 'utf8');
    const used = [...source.matchAll(/\.\$([A-Za-z_]\w*)/g)].map(m => m[1]).filter(name => name !== 'connect' && name !== 'disconnect');
    expect(used).toEqual([]);
    // Bracket access reaches the same methods and is not allowed either.
    expect(source).not.toMatch(/\[\s*['"`]\$/);
  });

  it('run: a seed run records no client call', () => {
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    const result = spawnSync(process.execPath, ['-r', PRELOAD, TS_NODE_BIN, SEED], {
      cwd,
      env: { ...baseEnv(), ADMIN_PASSWORD: 'a-strong-admin-pass-1', FAKE_EXISTING_USERNAMES: '' },
      encoding: 'utf8',
      timeout: 90_000,
      killSignal: 'SIGKILL',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n').filter(l => l.startsWith('FAKE_CLIENT_CALL'))).toEqual([]);
  }, 120_000);
});
