/**
 * prisma/seed.ts and ADMIN_PASSWORD.
 *
 * The seed runs main() on import, so this runs it as a child process (the same
 * `ts-node prisma/seed.ts` the entrypoint runs, transpile-only for speed) with
 * @prisma/client replaced by an in-memory stand-in (helpers/fakePrismaClientPreload.js),
 * so no database is needed and every write is visible in the output.
 *
 *   admin absent  -> a missing, blank, example or short ADMIN_PASSWORD is refused
 *                    (exit 1, nothing written); a strong one creates the admin
 *   admin present -> the start continues (exit 0): a weak value that is set only
 *                    warns once, an unset or blank value is silent
 *
 * In every case the value never appears in the output.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { PLACEHOLDER_ADMIN_PASSWORDS, MIN_ADMIN_PASSWORD_LENGTH } from '../utils/env-validation';

const SERVER_DIR = path.resolve(__dirname, '../..');
const TS_NODE_BIN = require.resolve('ts-node/dist/bin.js');
const PRELOAD = path.join(__dirname, 'helpers', 'fakePrismaClientPreload.js');
const STRONG = 'a-strong-admin-pass-1';

let scratch: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-admin-pw-'));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function runSeed(adminPassword: string | undefined, adminExists: boolean) {
  // Minimal environment: nothing from the caller's real HOME or secrets.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: scratch,
    TMPDIR: scratch,
    TS_NODE_TRANSPILE_ONLY: '1',
    FAKE_ADMIN_EXISTS: adminExists ? '1' : '0',
  };
  if (adminPassword !== undefined) env.ADMIN_PASSWORD = adminPassword;
  const result = spawnSync(process.execPath, ['-r', PRELOAD, TS_NODE_BIN, 'prisma/seed.ts'], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: 90_000,
    killSignal: 'SIGKILL',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, error: result.error };
}

const warnings = (output: string) => output.split('\n').filter(line => line.includes('already exists and keeps'));
const writes = (output: string) => output.split('\n').filter(line => line.startsWith('FAKE_WRITE'));
const PLACEHOLDER = PLACEHOLDER_ADMIN_PASSWORDS[0];
const SHORT = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);

describe('seed, admin user absent', () => {
  const refused: Array<[string, string | undefined, string]> = [
    ['the example value', PLACEHOLDER, 'placeholder value from .env.example'],
    ['the example value padded with whitespace', `  ${PLACEHOLDER}\t`, 'placeholder value from .env.example'],
    ['a value shorter than the minimum', SHORT, `shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`],
    ['an unset value (no built-in fallback)', undefined, 'ADMIN_PASSWORD is not set'],
    ['a whitespace-only value', '   ', 'ADMIN_PASSWORD is not set'],
  ];

  for (const [label, value, reason] of refused) {
    it(`exits 1 with a clear reason for ${label}, writes nothing, and does not print the value`, () => {
      const { status, output, error } = runSeed(value, false);
      expect(error).toBeUndefined();
      expect(status).toBe(1);
      expect(output).toContain('Refusing to create the admin user');
      expect(output).toContain(reason);
      expect(writes(output)).toEqual([]);
      expect(output).not.toContain('Seed complete');
      if (value !== undefined && value.trim() !== '') expect(output).not.toContain(value.trim());
    }, 120_000);
  }

  it('creates the admin with a strong value, without a warning, and does not print the value', () => {
    const { status, output } = runSeed(STRONG, false);
    expect(status).toBe(0);
    expect(output).toContain('Seed complete');
    expect(writes(output)).toContain('FAKE_WRITE user.upsert');
    expect(output).not.toContain('Refusing');
    expect(warnings(output)).toEqual([]);
    expect(output).not.toContain(STRONG);
  }, 120_000);
});

describe('seed, admin user already exists', () => {
  const warned: Array<[string, string, string]> = [
    ['the example value', PLACEHOLDER, 'placeholder value from .env.example'],
    ['the example value padded with whitespace', ` ${PLACEHOLDER} `, 'placeholder value from .env.example'],
    ['a value shorter than the minimum', SHORT, `shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`],
  ];

  for (const [label, value, reason] of warned) {
    it(`continues and warns once for ${label}, and does not print the value`, () => {
      const { status, output } = runSeed(value, true);
      expect(status).toBe(0);
      expect(output).toContain('Seed complete');
      expect(warnings(output)).toHaveLength(1);
      expect(warnings(output)[0]).toContain(reason);
      expect(output).not.toContain('Refusing');
      expect(output).not.toContain(value.trim());
    }, 120_000);
  }

  for (const [label, value] of [['unset', undefined], ['blank', '  ']] as Array<[string, string | undefined]>) {
    it(`continues silently for an ${label} value`, () => {
      const { status, output } = runSeed(value, true);
      expect(status).toBe(0);
      expect(output).toContain('Seed complete');
      expect(output).not.toContain('ADMIN_PASSWORD');
    }, 120_000);
  }

  it('continues silently for a strong value', () => {
    const { status, output } = runSeed(STRONG, true);
    expect(status).toBe(0);
    expect(output).not.toContain('ADMIN_PASSWORD');
    expect(output).not.toContain(STRONG);
  }, 120_000);

  it('only flags the existing admin: it updates, never creates, the admin user', () => {
    const { output } = runSeed(PLACEHOLDER, true);
    expect(writes(output)).toContain('FAKE_WRITE user.update');
    // The sample agents go through user.upsert; only the admin uses user.update.
    expect(writes(output).filter(line => line === 'FAKE_WRITE user.update')).toHaveLength(1);
  }, 120_000);
});
