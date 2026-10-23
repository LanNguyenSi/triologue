/**
 * `make local-env` generates real JWT_SECRET / ENCRYPTION_KEY values when the
 * .env copy still carries the .env.example placeholder, or lacks the variable.
 *
 * The target runs against a scratch ENV_FILE inside a temporary directory
 * (ENV_FILE and ENV_LOCAL_FALLBACK are Makefile variables), so the real .env
 * of the checkout is never read or written.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PLACEHOLDER_SECRETS, MIN_SECRET_LENGTH, findWeakSecrets } from '../utils/env-validation';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const KEEP = 'keep-this-value-0123456789abcdef0123456789abcdef';

let dir: string;
let envFile: string;

function runLocalEnv(env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(
    'make',
    ['-C', REPO_ROOT, 'local-env', `ENV_FILE=${envFile}`, `ENV_LOCAL_FALLBACK=${path.join(dir, 'absent.env.local')}`],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL', env },
  );
}

/** Parses KEY=value lines the way dotenv does for these cases: the last line wins, quotes are stripped. */
function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1).replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/** How many lines of the file assign the variable (a stale duplicate would hide a placeholder). */
function assignments(key: string): number {
  return fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .filter(line => new RegExp(`^\\s*(export\\s+)?${key}=`).test(line)).length;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-env-'));
  envFile = path.join(dir, '.env');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('make local-env secret generation', () => {
  it('replaces the placeholders of a fresh copy of .env.example with real secrets', () => {
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    const env = readEnv();
    expect(PLACEHOLDER_SECRETS.JWT_SECRET).not.toContain(env.JWT_SECRET);
    expect(PLACEHOLDER_SECRETS.ENCRYPTION_KEY).not.toContain(env.ENCRYPTION_KEY);
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(env.ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(findWeakSecrets(env)).toEqual([]);
    expect(assignments('JWT_SECRET')).toBe(1);
    expect(assignments('ENCRYPTION_KEY')).toBe(1);
    // Other lines of the copied template survive, and the secret is not echoed.
    expect(env.PORT).toBe('3001');
    expect(res.stdout).not.toContain(env.JWT_SECRET);
    expect(res.stdout).not.toContain(env.ENCRYPTION_KEY);
  });

  it('replaces a quoted placeholder', () => {
    fs.writeFileSync(
      envFile,
      `JWT_SECRET="${PLACEHOLDER_SECRETS.JWT_SECRET[0]}"\nENCRYPTION_KEY='${PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0]}'\n`,
    );
    expect(runLocalEnv().status).toBe(0);
    expect(findWeakSecrets(readEnv())).toEqual([]);
    expect(assignments('JWT_SECRET')).toBe(1);
    expect(assignments('ENCRYPTION_KEY')).toBe(1);
  });

  it('keeps real values that are already present', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${KEEP}-k\nPORT=4242\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET).toBe(KEEP);
    expect(env.ENCRYPTION_KEY).toBe(`${KEEP}-k`);
    expect(env.PORT).toBe('4242');
  });

  it('generates only the placeholder one and keeps the real one', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0]}\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET).toBe(KEEP);
    expect(PLACEHOLDER_SECRETS.ENCRYPTION_KEY).not.toContain(env.ENCRYPTION_KEY);
    expect(env.ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
  });

  it('adds a secret that is missing from .env entirely', () => {
    fs.writeFileSync(envFile, 'PORT=4242\n');
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(findWeakSecrets(env)).toEqual([]);
    expect(env.JWT_SECRET).toBeTruthy();
    expect(env.ENCRYPTION_KEY).toBeTruthy();
    expect(env.PORT).toBe('4242');
  });

  it('replaces an empty value', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=\nENCRYPTION_KEY=${KEEP}\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(env.ENCRYPTION_KEY).toBe(KEEP);
  });

  it('replaces a whitespace-only value', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=   \nENCRYPTION_KEY="  "\nPORT=4242\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(env.ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(findWeakSecrets(env)).toEqual([]);
    expect(assignments('JWT_SECRET')).toBe(1);
    expect(assignments('ENCRYPTION_KEY')).toBe(1);
    expect(env.PORT).toBe('4242');
  });

  it('replaces a placeholder that has leading and trailing whitespace', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=  ${PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0]}  \n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET).toBe(KEEP);
    expect(findWeakSecrets(env)).toEqual([]);
    expect(assignments('ENCRYPTION_KEY')).toBe(1);
  });

  it('lets the last assignment win: a real value after a placeholder is kept', () => {
    const placeholder = PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0];
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${placeholder}\nENCRYPTION_KEY=${KEEP}-k\n`);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated ENCRYPTION_KEY');
    expect(readEnv().ENCRYPTION_KEY).toBe(`${KEEP}-k`);
    expect(assignments('ENCRYPTION_KEY')).toBe(2);
  });

  it('replaces a placeholder that comes last even when a real value comes first', () => {
    const placeholder = PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0];
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${KEEP}-k\nENCRYPTION_KEY=${placeholder}\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.ENCRYPTION_KEY).not.toBe(`${KEEP}-k`);
    expect(findWeakSecrets(env)).toEqual([]);
    expect(assignments('ENCRYPTION_KEY')).toBe(1);
  });

  it('keeps a real value written in export form', () => {
    fs.writeFileSync(envFile, `export JWT_SECRET=${KEEP}\nexport  ENCRYPTION_KEY="${KEEP}-k"\n`);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated');
    expect(fs.readFileSync(envFile, 'utf8')).toBe(`export JWT_SECRET=${KEEP}\nexport  ENCRYPTION_KEY="${KEEP}-k"\n`);
  });

  it('keeps a real value on an indented line', () => {
    fs.writeFileSync(envFile, `  JWT_SECRET=${KEEP}\n\tENCRYPTION_KEY=${KEEP}-k\n`);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated');
  });

  it('replaces an indented placeholder without leaving the old line behind', () => {
    fs.writeFileSync(envFile, `  JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}-k\n`);
    expect(runLocalEnv().status).toBe(0);
    expect(findWeakSecrets(readEnv())).toEqual([]);
    expect(assignments('JWT_SECRET')).toBe(1);
    expect(fs.readFileSync(envFile, 'utf8')).not.toContain(PLACEHOLDER_SECRETS.JWT_SECRET[0]);
  });

  it('replaces an export-form placeholder without leaving the old line behind', () => {
    fs.writeFileSync(envFile, `export JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}-k\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(findWeakSecrets(env)).toEqual([]);
    expect(assignments('JWT_SECRET')).toBe(1);
    expect(fs.readFileSync(envFile, 'utf8')).not.toContain('export JWT_SECRET');
  });

  it('leaves .env untouched and fails when mktemp fails', () => {
    // A stub mktemp first on PATH makes the temp-file step fail; the recipe must
    // stop instead of truncating .env through an empty temp-file name.
    const stubDir = path.join(dir, 'stub-bin');
    fs.mkdirSync(stubDir);
    fs.writeFileSync(path.join(stubDir, 'mktemp'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const before = `JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}-k\nPORT=4242\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv({ ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH}` });
    expect(res.status).not.toBe(0);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(before);
  });

  it('is idempotent: a second run keeps the generated secrets', () => {
    expect(runLocalEnv().status).toBe(0);
    const first = readEnv();
    expect(runLocalEnv().status).toBe(0);
    const second = readEnv();
    expect(second.JWT_SECRET).toBe(first.JWT_SECRET);
    expect(second.ENCRYPTION_KEY).toBe(first.ENCRYPTION_KEY);
  });
});
