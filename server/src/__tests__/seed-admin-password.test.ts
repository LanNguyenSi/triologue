/**
 * prisma/seed.ts refuses a missing, example or short ADMIN_PASSWORD before it
 * touches the database, and never prints the value.
 *
 * The seed runs main() on import, so this runs it as a child process (the same
 * `ts-node prisma/seed.ts` the entrypoint runs, transpile-only for speed). The
 * refusal comes before the first query, so no database is needed: the
 * DATABASE_URL below points at a closed port and is never connected to.
 * The accept path is covered by findWeakAdminPassword in env-validation.test.ts.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { PLACEHOLDER_ADMIN_PASSWORDS, MIN_ADMIN_PASSWORD_LENGTH } from '../utils/env-validation';

const SERVER_DIR = path.resolve(__dirname, '../..');
const TS_NODE_BIN = require.resolve('ts-node/dist/bin.js');

let scratch: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-admin-pw-'));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function runSeed(adminPassword: string | undefined) {
  // Minimal environment: nothing from the caller's real HOME or secrets.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: scratch,
    TMPDIR: scratch,
    TS_NODE_TRANSPILE_ONLY: '1',
    DATABASE_URL: 'postgresql://seed_test:seed_test@127.0.0.1:1/seed_test',
  };
  if (adminPassword !== undefined) env.ADMIN_PASSWORD = adminPassword;
  const result = spawnSync(process.execPath, [TS_NODE_BIN, 'prisma/seed.ts'], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 90_000,
    killSignal: 'SIGKILL',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, error: result.error };
}

describe('seed ADMIN_PASSWORD guard', () => {
  const cases: Array<[string, string | undefined, string]> = [
    ['the example value', PLACEHOLDER_ADMIN_PASSWORDS[0], 'placeholder value from .env.example'],
    ['the example value padded with whitespace', `  ${PLACEHOLDER_ADMIN_PASSWORDS[0]}\t`, 'placeholder value from .env.example'],
    ['a value shorter than the minimum', 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1), `shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`],
    ['an unset value', undefined, 'ADMIN_PASSWORD is not set'],
    ['a whitespace-only value', '   ', 'ADMIN_PASSWORD is not set'],
  ];

  for (const [label, value, reason] of cases) {
    it(`exits 1 with a clear reason for ${label}, before any database access, and does not print the value`, () => {
      const { status, output, error } = runSeed(value);
      expect(error).toBeUndefined();
      expect(status).toBe(1);
      expect(output).toContain('Refusing to seed the admin user');
      expect(output).toContain(reason);
      // The refusal precedes the first room upsert, so no seeding step ran and
      // no database error (closed port) was reached.
      expect(output).not.toContain('room: Onboarding');
      expect(output).not.toMatch(/ECONNREFUSED|Can't reach database/);
      if (value !== undefined && value.trim() !== '') {
        expect(output).not.toContain(value.trim());
      }
    }, 120_000);
  }
});
