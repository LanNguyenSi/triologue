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
 * Passwords are pinned through the stand-in's record of every write call that
 * carries a `passwordHash` key anywhere in its arguments, whatever the model or
 * method. Each scenario asserts the complete list: exactly one such write, the
 * hash on the create path of the admin and a bcrypt hash of ADMIN_PASSWORD, when
 * the admin is created, and none otherwise (so an existing admin's password is
 * never written, on any update path).
 *
 * "Admin" means the user named ADMIN_USERNAME (default `lan`): when that name
 * points to a user that does not exist, the database counts as admin absent
 * even if other users exist.
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

interface SeedScenario {
  /** Usernames that already exist in the fake database. */
  existing: string[];
  /** ADMIN_USERNAME for the run; unset when omitted (the seed then uses `lan`). */
  adminUsername?: string;
  /** Models (other than user) whose lookups find an existing record. */
  records?: string[];
}

function runSeed(adminPassword: string | undefined, scenario: SeedScenario | boolean) {
  const { existing, adminUsername, records = [] } = typeof scenario === 'boolean'
    ? { existing: scenario ? ['lan'] : [], adminUsername: undefined }
    : scenario;
  // Minimal environment: nothing from the caller's real HOME or secrets.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: scratch,
    TMPDIR: scratch,
    TS_NODE_TRANSPILE_ONLY: '1',
    FAKE_EXISTING_USERNAMES: existing.join(','),
    FAKE_EXISTING_RECORDS: records.join(','),
  };
  if (adminPassword !== undefined) env.ADMIN_PASSWORD = adminPassword;
  if (adminUsername !== undefined) env.ADMIN_USERNAME = adminUsername;
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
const passwordWrites = (output: string) => output.split('\n').filter(line => line.startsWith('FAKE_PASSWORD_WRITE'));
const createdUsers = (output: string) => output.split('\n').filter(line => line.startsWith('FAKE_CREATED_USER='));
// The one password write of a seed that creates the admin: the create side of
// the user upsert, holding a bcrypt hash of ADMIN_PASSWORD.
const ADMIN_HASH_WRITE = 'FAKE_PASSWORD_WRITE model=user method=upsert path=create.passwordHash matches=true';
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
      expect(passwordWrites(output)).toEqual([]);
      expect(createdUsers(output)).toEqual([]);
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
    // The only password written is the new admin's, as a bcrypt hash of
    // ADMIN_PASSWORD (not of some other value), on the create path.
    expect(passwordWrites(output)).toEqual([ADMIN_HASH_WRITE]);
    // The admin is created under the default name, then the sample agents.
    expect(createdUsers(output)).toEqual(['FAKE_CREATED_USER=lan', 'FAKE_CREATED_USER=ice', 'FAKE_CREATED_USER=lava']);
  }, 120_000);
});

describe('seed, ADMIN_USERNAME points to a user that does not exist on a populated database', () => {
  // Other users (the default admin name and both sample agents) exist, but not
  // the one named ADMIN_USERNAME: the seed would create it, so the password
  // rules of the admin-absent case apply. This is what happens after
  // ADMIN_USERNAME is changed or the admin user is deleted.
  const scenario: SeedScenario = { existing: ['lan', 'ice', 'lava'], adminUsername: 'renamed-admin' };

  it('refuses an unset value, writes nothing, and does not complete', () => {
    const { status, output, error } = runSeed(undefined, scenario);
    expect(error).toBeUndefined();
    expect(status).toBe(1);
    expect(output).toContain('Refusing to create the admin user');
    expect(output).toContain('ADMIN_PASSWORD is not set');
    expect(writes(output)).toEqual([]);
    expect(passwordWrites(output)).toEqual([]);
    expect(output).not.toContain('Seed complete');
  }, 120_000);

  it('refuses the example value and does not print it', () => {
    const { status, output } = runSeed(PLACEHOLDER, scenario);
    expect(status).toBe(1);
    expect(output).toContain('Refusing to create the admin user');
    expect(writes(output)).toEqual([]);
    expect(passwordWrites(output)).toEqual([]);
    expect(output).not.toContain(PLACEHOLDER);
  }, 120_000);

  it('creates the renamed admin with a strong value, hashed from that value', () => {
    const { status, output } = runSeed(STRONG, scenario);
    expect(status).toBe(0);
    expect(output).toContain('Seed complete');
    expect(output).not.toContain('Refusing');
    expect(warnings(output)).toEqual([]);
    expect(writes(output)).toContain('FAKE_WRITE user.upsert');
    expect(writes(output)).not.toContain('FAKE_WRITE user.update');
    expect(passwordWrites(output)).toEqual([ADMIN_HASH_WRITE]);
    // Only the new admin is created under the configured name, not under the
    // default one; the sample agents already exist.
    expect(createdUsers(output)).toEqual(['FAKE_CREATED_USER=renamed-admin']);
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
      expect(passwordWrites(output)).toEqual([]);
    }, 120_000);
  }

  for (const [label, value] of [['unset', undefined], ['blank', '  ']] as Array<[string, string | undefined]>) {
    it(`continues silently for an ${label} value`, () => {
      const { status, output } = runSeed(value, true);
      expect(status).toBe(0);
      expect(output).toContain('Seed complete');
      expect(output).not.toContain('ADMIN_PASSWORD');
      expect(passwordWrites(output)).toEqual([]);
    }, 120_000);
  }

  it('continues silently for a strong value', () => {
    const { status, output } = runSeed(STRONG, true);
    expect(status).toBe(0);
    expect(output).not.toContain('ADMIN_PASSWORD');
    expect(output).not.toContain(STRONG);
    // A strong value is not applied to the existing admin either.
    expect(passwordWrites(output)).toEqual([]);
  }, 120_000);

  it('only flags the existing admin: it updates, never creates, the admin user', () => {
    const { output } = runSeed(PLACEHOLDER, true);
    expect(writes(output)).toContain('FAKE_WRITE user.update');
    // The sample agents go through user.upsert; only the admin uses user.update.
    expect(writes(output).filter(line => line === 'FAKE_WRITE user.update')).toHaveLength(1);
    // No password is written for an existing admin, on any write path.
    expect(passwordWrites(output)).toEqual([]);
    expect(createdUsers(output)).toEqual(['FAKE_CREATED_USER=ice', 'FAKE_CREATED_USER=lava']);
  }, 120_000);
});

describe('seed, every user and token already exists (a second run)', () => {
  const scenario: SeedScenario = { existing: ['lan', 'ice', 'lava'], records: ['agentToken'] };

  it('writes no password on any update path, whatever the ADMIN_PASSWORD', () => {
    for (const value of [STRONG, PLACEHOLDER, undefined]) {
      const { status, output } = runSeed(value, scenario);
      expect(status).toBe(0);
      expect(writes(output)).toContain('FAKE_WRITE agentToken.update');
      expect(writes(output)).not.toContain('FAKE_WRITE agentToken.create');
      expect(passwordWrites(output)).toEqual([]);
      expect(createdUsers(output)).toEqual([]);
    }
  }, 240_000);
});
