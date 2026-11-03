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
 *
 * The scan flags any `$name` identifier or string other than a template
 * placeholder `${` and `$connect`/`$disconnect`, so dotted calls, destructuring
 * (`const { $executeRaw: sql } = prisma`) and string-held keys
 * (`prisma["$executeRawUnsafe"]`) are all caught. Comments are not stripped (the
 * current seed has no `$` in one).
 *
 * Limits, stated honestly: a key built from pieces ("$exe" + "cuteRaw"), written
 * with an escape sequence, or reached through Reflect.get is invisible to the
 * scan; and the scan reads seed.ts only, not helper modules it imports that
 * receive the client (connectors/mcp/agentTasksSeed.ts). The recorded side
 * (FAKE_CLIENT_CALL in the seed-run tests) covers those paths for the scenarios
 * the tests run.
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

/** Every `$name` identifier in a source text, minus template placeholders and the lifecycle calls. */
export function clientDollarNames(source: string): string[] {
  return [...source.matchAll(/\$(?!connect\b|disconnect\b)[A-Za-z_]\w*/g)].map(m => m[0]);
}

describe('prisma/seed.ts uses no client-level $ method', () => {
  it('source: no `$name` other than $connect and $disconnect', () => {
    expect(clientDollarNames(fs.readFileSync(SEED, 'utf8'))).toEqual([]);
  });

  describe('the scan itself', () => {
    const cases: Array<[string, string, string[]]> = [
      ['a dotted call', 'await prisma.$executeRaw`x`;', ['$executeRaw']],
      ['destructuring', 'const { $executeRaw: rawSql } = prisma;', ['$executeRaw']],
      ['a string-held key', 'const RAW = "$executeRawUnsafe"; prisma[RAW]("x");', ['$executeRawUnsafe']],
      ['bracket access', 'prisma["$queryRaw"]`x`;', ['$queryRaw']],
      ['$transaction', 'await prisma.$transaction([]);', ['$transaction']],
      ['lifecycle calls and template placeholders only', 'await prisma.$connect(); console.log(`${a}`); prisma.$disconnect();', []],
    ];
    for (const [label, source, expected] of cases) {
      it(`reports ${label}`, () => {
        expect(clientDollarNames(source)).toEqual(expected);
      });
    }
  });

  const run = (existing: string, records: string, userTypes = '') => {
    const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
    return spawnSync(process.execPath, ['-r', PRELOAD, TS_NODE_BIN, SEED], {
      cwd,
      env: { ...baseEnv(), ADMIN_PASSWORD: 'a-strong-admin-pass-1', FAKE_EXISTING_USERNAMES: existing, FAKE_EXISTING_RECORDS: records, FAKE_USER_TYPES: userTypes },
      encoding: 'utf8',
      timeout: 90_000,
      killSignal: 'SIGKILL',
    });
  };
  const scenarios: Array<[string, string, string, string]> = [
    ['a fresh database', '', '', ''],
    ['every user and token existing', 'lan,ice,lava', 'agentToken', ''],
    ['existing agents without tokens', 'lan,ice,lava', '', ''],
    ['an existing human named like an agent', 'lan,ice,lava', '', 'ice=HUMAN'],
  ];
  for (const [label, existing, records, types] of scenarios) {
    it(`run: no client call is recorded with ${label}`, () => {
      const result = run(existing, records, types);
      expect(result.status).toBe(0);
      expect(result.stdout.split('\n').filter(l => l.startsWith('FAKE_CLIENT_CALL'))).toEqual([]);
    }, 120_000);
  }
});
