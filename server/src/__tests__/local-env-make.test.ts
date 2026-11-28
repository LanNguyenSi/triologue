/**
 * `make local-env` generates real JWT_SECRET / ENCRYPTION_KEY values when the
 * .env copy still carries the .env.example placeholder, or lacks the variable.
 *
 * The target reads and rewrites .env with the same parser the server uses
 * (the dotenv package from server/node_modules, driven by
 * server/scripts/local-env.js), so every dotenv-accepted assignment form is
 * understood and the last assignment wins.
 *
 * An unrelated multi-line quoted value (a note, a PEM key) is kept byte for
 * byte; the script only refuses when the regenerated variable itself cannot
 * be mapped to single lines.
 *
 * The target runs against a scratch ENV_FILE inside a temporary directory
 * (ENV_FILE and ENV_LOCAL_FALLBACK are Makefile variables), so the real .env
 * of the checkout is never read or written.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse as parseDotenv } from 'dotenv';
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

/** Reads the current file the way the server reads .env: dotenv, last assignment wins. */
function readEnv(): Record<string, string> {
  return { ...parseDotenv(fs.readFileSync(envFile, 'utf8')) };
}

/** True when the line, read on its own by dotenv, assigns exactly key. */
function assignsLine(line: string, key: string): boolean {
  const keys = Object.keys(parseDotenv(line));
  return keys.length === 1 && keys[0] === key;
}

/** How many lines of the file assign the variable (a stale duplicate would hide a placeholder). */
function assignments(key: string): number {
  return fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .filter(line => assignsLine(line, key)).length;
}

function content(): string {
  return fs.readFileSync(envFile, 'utf8');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-env-'));
  envFile = path.join(dir, '.env');
});

afterEach(() => {
  fs.chmodSync(dir, 0o755);
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

  // `make local-env` stays a two-secret target; the dev targets add ADMIN_PASSWORD
  // through the same script (target `dev-env`, which `_dev` depends on), so the dev
  // stack does not start with the placeholder the seed refuses. Only targets whose
  // recipe has no $(MAKE) are dry-run: `make -n` still executes a recipe line that
  // references $(MAKE), and `_dev` would then start the real compose stack.
  it('wires ADMIN_PASSWORD generation into dev-env, which the dev target chain needs, not into local-env', () => {
    const dry = (target: string) =>
      spawnSync('make', ['-n', '-C', REPO_ROOT, target, `ENV_FILE=${envFile}`], { encoding: 'utf8', timeout: 30000 }).stdout;
    expect(dry('dev-env')).toMatch(/local-env\.js .*ADMIN_PASSWORD/);
    expect(dry('dev-env')).toMatch(/local-env\.js .*ADMIN_USERNAME=dev-admin/);
    expect(dry('local-env')).not.toContain('ADMIN_PASSWORD');
    const makefile = fs.readFileSync(path.join(REPO_ROOT, 'Makefile'), 'utf8');
    expect(makefile).toMatch(/^_dev: dev-env$/m);
    expect(makefile).toMatch(/^dev: .*\n\t@\$\(MAKE\) _dev MODE=api$/m);
    expect(makefile).toMatch(/^dev-full: .*\n\t@\$\(MAKE\) _dev MODE=full$/m);
  });

  it('replaces the ADMIN_PASSWORD placeholder, which the seed refuses, and does not echo it', () => {
    fs.writeFileSync(envFile, fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8'));
    const res = spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, 'ADMIN_PASSWORD'], { encoding: 'utf8', timeout: 30000 });
    expect(res.status).toBe(0);
    const env = readEnv();
    expect(env.ADMIN_PASSWORD).not.toBe('change_this_secure_password');
    expect(env.ADMIN_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
    expect(assignments('ADMIN_PASSWORD')).toBe(1);
    expect(res.stdout + res.stderr).not.toContain(env.ADMIN_PASSWORD);
  });

  // ADMIN_USERNAME has no random value: dev-env passes a fixed default that is
  // written only when the variable is missing or blank. The set value wins.
  const adminUsernameArgs = ['ADMIN_PASSWORD', 'ADMIN_USERNAME=dev-admin'];
  const runAdmin = () =>
    spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, ...adminUsernameArgs], { encoding: 'utf8', timeout: 30000 });

  it('fills the blank ADMIN_USERNAME of a fresh copy of .env.example with the dev default', () => {
    fs.writeFileSync(envFile, fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8'));
    expect(runAdmin().status).toBe(0);
    expect(readEnv().ADMIN_USERNAME).toBe('dev-admin');
    expect(assignments('ADMIN_USERNAME')).toBe(1);
  });

  it('fills an ADMIN_USERNAME that is missing', () => {
    fs.writeFileSync(envFile, 'OTHER=1\n');
    expect(runAdmin().status).toBe(0);
    expect(readEnv().ADMIN_USERNAME).toBe('dev-admin');
  });

  it('fills a whitespace-only ADMIN_USERNAME', () => {
    fs.writeFileSync(envFile, 'ADMIN_USERNAME="   "\n');
    expect(runAdmin().status).toBe(0);
    expect(readEnv().ADMIN_USERNAME).toBe('dev-admin');
    expect(assignments('ADMIN_USERNAME')).toBe(1);
  });

  describe('refuses an invalid VAR=default argument and leaves .env untouched', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['a name with a space', 'BAD NAME=x', /invalid variable name/],
      ['an empty name', '=foo', /invalid variable name/],
      ['an empty default', 'ADMIN_USERNAME=', /invalid default for ADMIN_USERNAME/],
      ['a default with a newline', 'ADMIN_USERNAME=a\nEVIL=1', /invalid default for ADMIN_USERNAME/],
      ['a default with a hash', 'ADMIN_USERNAME=a#b', /invalid default for ADMIN_USERNAME/],
    ];
    for (const [label, arg, message] of cases) {
      it(`for ${label}`, () => {
        fs.writeFileSync(envFile, 'OTHER=1\n');
        const res = spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, arg], { encoding: 'utf8', timeout: 30000 });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toMatch(message);
        expect(content()).toBe('OTHER=1\n');
      });
    }
  });

  // A bare VAR is a variable name too and is validated with the same rule as
  // the name of a VAR=default argument, before the file is read.
  describe('refuses an invalid bare VAR argument and leaves .env untouched', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['a bare name with a space', 'BAD NAME', /invalid variable name/],
      ['a bare name starting with a digit', '1ABC', /invalid variable name/],
      ['a bare empty name', '', /invalid variable name/],
    ];
    for (const [label, arg, message] of cases) {
      it(`for ${label}`, () => {
        fs.writeFileSync(envFile, 'OTHER=1\n');
        const res = spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, arg], { encoding: 'utf8', timeout: 30000 });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toMatch(message);
        expect(content()).toBe('OTHER=1\n');
      });
    }
  });

  // Names Object.prototype already carries would be answered by the inherited
  // value when the parsed file is read as a plain object (value.trim is not a
  // function), so they are refused in both forms with a clear message.
  describe('refuses a variable name that is a property of Object.prototype and leaves .env untouched', () => {
    const cases: Array<[string, string]> = [
      ['__proto__', '__proto__'],
      ['constructor with a default', 'constructor=dev-admin'],
      ['toString', 'toString'],
    ];
    for (const [label, arg] of cases) {
      it(`refuses ${label}`, () => {
        fs.writeFileSync(envFile, 'OTHER=1\n');
        const res = spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, arg], { encoding: 'utf8', timeout: 30000 });
        expect(res.status).not.toBe(0);
        expect(res.stderr).toMatch(/invalid variable name .* reserved/);
        expect(res.stderr).not.toMatch(/TypeError/);
        expect(res.stderr).not.toMatch(/at .*local-env\.js/);
        expect(content()).toBe('OTHER=1\n');
      });
    }
  });

  it('regenerates the placeholder next to a .env key named constructor and keeps that key byte for byte', () => {
    // The .env itself assigns constructor: the reads of the parsed file use
    // own-property access, so the key behaves as a plain variable and the
    // JWT_SECRET placeholder next to it is still regenerated.
    const before = `constructor=1\nJWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(env.ENCRYPTION_KEY).toBe(KEEP);
    expect(readEnv()['constructor']).toBe('1');
    expect(content()).toBe(`constructor=1\nENCRYPTION_KEY=${KEEP}\nJWT_SECRET=${env.JWT_SECRET}\n`);
  });

  for (const key of ['ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
    it(`refuses when a blank colon-form ${key} at the end of the file would swallow the appended line`, () => {
      // dotenv reads `${key}:` with no value and no final newline as blank, so
      // the variable is (re)generated; the appended line would then merge into
      // that value. Only the post-write read-back of the new key catches it.
      const before = `OTHER=1\n${key}:`;
      fs.writeFileSync(envFile, before);
      const res = runAdmin();
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('would change what dotenv reads');
      expect(content()).toBe(before);
    });
  }

  it('refuses a default that holds a newline without any other forbidden character', () => {
    fs.writeFileSync(envFile, 'OTHER=1\n');
    const res = spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, 'ADMIN_USERNAME=a\nb'], { encoding: 'utf8', timeout: 30000 });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/invalid default for ADMIN_USERNAME/);
    expect(content()).toBe('OTHER=1\n');
  });

  it('does not tell the operator to write 64 hex chars for a defaulted variable', () => {
    // An assignment inside another variable's multi-line value cannot be rewritten.
    fs.writeFileSync(envFile, 'NOTE="a\nADMIN_USERNAME=old\nb"\n');
    const res = runAdmin();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('ADMIN_USERNAME=dev-admin yourself');
    expect(res.stderr).not.toContain('64 hex');
  });

  it('keeps an ADMIN_USERNAME the operator set, even lan', () => {
    for (const name of ['my-admin', 'lan']) {
      fs.writeFileSync(envFile, `ADMIN_USERNAME=${name}\n`);
      expect(runAdmin().status).toBe(0);
      expect(readEnv().ADMIN_USERNAME).toBe(name);
    }
  });

  it('keeps an ADMIN_PASSWORD the operator set', () => {
    fs.writeFileSync(envFile, `ADMIN_PASSWORD=${KEEP}-a\n`);
    const res = spawnSync('node', [path.join(REPO_ROOT, 'server/scripts/local-env.js'), envFile, 'ADMIN_PASSWORD'], { encoding: 'utf8', timeout: 30000 });
    expect(res.status).toBe(0);
    expect(readEnv().ADMIN_PASSWORD).toBe(`${KEEP}-a`);
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

  it('replaces a quoted placeholder padded with whitespace inside the quotes', () => {
    // dotenv keeps whitespace inside quotes, so only a comparison that
    // trims both sides sees the placeholder here.
    const ph = PLACEHOLDER_SECRETS.JWT_SECRET[0];
    fs.writeFileSync(envFile, `JWT_SECRET="  ${ph}  "\nENCRYPTION_KEY=${KEEP}\n`);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Generated JWT_SECRET');
    expect(readEnv().JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(findWeakSecrets(readEnv())).toEqual([]);
    expect(content()).not.toContain(ph);
  });

  it('lets the last assignment win: a real value after a placeholder is kept', () => {
    const placeholder = PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0];
    const input = `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${placeholder}\nENCRYPTION_KEY=${KEEP}-k\n`;
    fs.writeFileSync(envFile, input);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated ENCRYPTION_KEY');
    expect(readEnv().ENCRYPTION_KEY).toBe(`${KEEP}-k`);
    expect(assignments('ENCRYPTION_KEY')).toBe(2);
    // The earlier placeholder line survives unchanged: it must not change
    // what dotenv reads, so nothing is rewritten at all.
    expect(content()).toBe(input);
  });

  it('replaces a placeholder that comes last even when a real value comes first', () => {
    const placeholder = PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0];
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${KEEP}-k\nENCRYPTION_KEY=${placeholder}\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.ENCRYPTION_KEY).not.toBe(`${KEEP}-k`);
    expect(findWeakSecrets(env)).toEqual([]);
    expect(assignments('ENCRYPTION_KEY')).toBe(1);
    // Every old assignment line is gone, including the superseded real one.
    expect(content()).not.toContain(`${KEEP}-k`);
    expect(content()).toContain(`JWT_SECRET=${KEEP}\n`);
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

  it('keeps a real value written as VAR = value', () => {
    const input = `JWT_SECRET = ${KEEP}\nENCRYPTION_KEY=${KEEP}-k\n`;
    fs.writeFileSync(envFile, input);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated');
    // Not a byte is rewritten, and no generated line is appended.
    expect(content()).toBe(input);
    expect(readEnv().JWT_SECRET).toBe(KEEP);
  });

  it('keeps a real value written as VAR: value', () => {
    const input = `JWT_SECRET: ${KEEP}\nENCRYPTION_KEY: ${KEEP}-k\n`;
    fs.writeFileSync(envFile, input);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated');
    expect(content()).toBe(input);
    expect(readEnv().JWT_SECRET).toBe(KEEP);
  });

  it('keeps a real value with a trailing comment', () => {
    const input = `JWT_SECRET=${KEEP} # rotate yearly\nENCRYPTION_KEY=${KEEP}-k # rotate yearly\n`;
    fs.writeFileSync(envFile, input);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toContain('Generated');
    expect(content()).toBe(input);
    // The dotenv value is the real secret without the comment.
    expect(readEnv().JWT_SECRET).toBe(KEEP);
  });

  it('replaces a placeholder written as VAR = value', () => {
    fs.writeFileSync(envFile, `JWT_SECRET = ${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}\n`);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Generated JWT_SECRET');
    expect(res.stdout).not.toContain('Generated ENCRYPTION_KEY');
    expect(content()).not.toContain(PLACEHOLDER_SECRETS.JWT_SECRET[0]);
    expect(assignments('JWT_SECRET')).toBe(1);
    const hex = readEnv().JWT_SECRET;
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(content()).toBe(`ENCRYPTION_KEY=${KEEP}\nJWT_SECRET=${hex}\n`);
  });

  it('replaces a placeholder with a trailing comment', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]} # do not ship this\nENCRYPTION_KEY=${KEEP}\n`);
    expect(runLocalEnv().status).toBe(0);
    expect(content()).not.toContain(PLACEHOLDER_SECRETS.JWT_SECRET[0]);
    expect(content()).not.toContain('# do not ship this');
    expect(assignments('JWT_SECRET')).toBe(1);
    const hex = readEnv().JWT_SECRET;
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(content()).toBe(`ENCRYPTION_KEY=${KEEP}\nJWT_SECRET=${hex}\n`);
  });

  it('keeps variables whose name merely contains the target name', () => {
    const input = `JWT_SECRET_OLD=old-${KEEP}\nMY_JWT_SECRET=x\nJWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}-k\n`;
    fs.writeFileSync(envFile, input);
    expect(runLocalEnv().status).toBe(0);
    const hex = readEnv().JWT_SECRET;
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(assignments('JWT_SECRET')).toBe(1);
    // The look-alike lines survive byte for byte.
    expect(content()).toBe(
      `JWT_SECRET_OLD=old-${KEEP}\nMY_JWT_SECRET=x\nENCRYPTION_KEY=${KEEP}-k\nJWT_SECRET=${hex}\n`,
    );
    const env = readEnv();
    expect(env.JWT_SECRET_OLD).toBe(`old-${KEEP}`);
    expect(env.MY_JWT_SECRET).toBe('x');
  });

  it('keeps other lines and comments byte for byte when regenerating', () => {
    const input = `${[
      '# header comment',
      'PORT=4242',
      `# JWT_SECRET=${KEEP}-in-a-comment`,
      'JWT_SECRET_OLD=old-value-keep',
      `JWT_SECRET   =   ${PLACEHOLDER_SECRETS.JWT_SECRET[0]}`,
      'NODE_ENV=development # trailing comment',
      '',
      `ENCRYPTION_KEY=${KEEP}-k`,
    ].join('\n')}\n`;
    fs.writeFileSync(envFile, input);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    const hex = readEnv().JWT_SECRET;
    const withoutTarget = input
      .split('\n')
      .filter(line => !assignsLine(line, 'JWT_SECRET'))
      .join('\n');
    // Everything except the regenerated variable's own line is untouched.
    expect(content()).toBe(`${withoutTarget}JWT_SECRET=${hex}\n`);
  });

  it('never prints secret values on stdout or stderr', () => {
    fs.writeFileSync(envFile, `JWT_SECRET=${KEEP}\nENCRYPTION_KEY=${PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0]}\n`);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    const hex = readEnv().ENCRYPTION_KEY;
    expect(res.stdout).toContain('Generated ENCRYPTION_KEY');
    const output = `${res.stdout}${res.stderr}`;
    expect(output).not.toContain(KEEP);
    expect(output).not.toContain(hex);
  });

  it('refuses to rewrite when an assignment sits inside a multi-line quoted value', () => {
    // dotenv supports multi-line quoted values; the script cannot map such
    // an assignment to lines, so it must refuse instead of guessing.
    const before = `NOTE="first\nJWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nsecond"\nENCRYPTION_KEY=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('JWT_SECRET could not be rewritten safely');
    expect(res.stderr).toContain('inside a multi-line quoted value');
    expect(res.stderr).toContain('add a line JWT_SECRET=<64 hex chars> yourself');
    expect(content()).toBe(before);
  });

  it('fails without touching .env when dotenv cannot be loaded', () => {
    // LOCAL_ENV_DOTENV_MODULE points the script at a non-existent module,
    // simulating a missing server/node_modules/dotenv.
    const before = `JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv({ ...process.env, LOCAL_ENV_DOTENV_MODULE: path.join(dir, 'absent-dotenv.js') });
    expect(res.status).not.toBe(0);
    expect(content()).toBe(before);
    expect(res.stderr).toContain('npm --prefix server ci');
  });

  it('leaves .env untouched and fails when the temp file cannot be written', () => {
    // The script rewrites only through a temp file in the same directory
    // plus a rename; a directory without write permission must fail instead
    // of truncating .env.
    const before = `JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}-k\nPORT=4242\n`;
    fs.writeFileSync(envFile, before);
    fs.chmodSync(dir, 0o500);
    let res: ReturnType<typeof runLocalEnv>;
    try {
      res = runLocalEnv();
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    expect(res.status).not.toBe(0);
    expect(content()).toBe(before);
  });

  it('keeps an unrelated multi-line quoted value and regenerates the placeholder', () => {
    const before = `NOTE="first line\nsecond line"\nJWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    const env = readEnv();
    expect(env.NOTE).toBe('first line\nsecond line');
    expect(env.ENCRYPTION_KEY).toBe(KEEP);
    expect(env.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(assignments('JWT_SECRET')).toBe(1);
    // The multi-line value is byte for byte the only NOTE text there was.
    expect(content()).toBe(
      `NOTE="first line\nsecond line"\nENCRYPTION_KEY=${KEEP}\nJWT_SECRET=${env.JWT_SECRET}\n`,
    );
  });

  it('keeps a PEM-style multi-line value and generates a missing key', () => {
    // Shaped like a PEM block (armour lines around a base64 body) without the
    // key header, so secret scanners do not read the fixture as a real key.
    const pem = '-----BEGIN TEST BLOCK-----\nMIIBVgIBADANBgkqhkiG9w0BA\n-----END TEST BLOCK-----';
    const before = `TLS_KEY="${pem}"\nJWT_SECRET=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv();
    expect(res.status).toBe(0);
    const env = readEnv();
    expect(env.TLS_KEY).toBe(pem);
    expect(env.ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(content()).toBe(`TLS_KEY="${pem}"\nJWT_SECRET=${KEEP}\nENCRYPTION_KEY=${env.ENCRYPTION_KEY}\n`);
  });

  it('refuses with an actionable message when the regenerated value itself spans multiple lines', () => {
    const before = `NOTE=keep\nJWT_SECRET="\n"\nENCRYPTION_KEY=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv();
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('JWT_SECRET could not be rewritten safely');
    expect(res.stderr).toContain('its value spans multiple lines');
    expect(res.stderr).toContain('add a line JWT_SECRET=<64 hex chars> yourself');
    expect(content()).toBe(before);
  });

  it('refuses when removing assignment lines would change another variable multiline value', () => {
    // The variable has its own top-level placeholder line, so the decision
    // and the per-variable check pass, but the same assignment also sits
    // inside NOTE; removing both lines would change NOTE, and the whole-file
    // verification must refuse.
    const before =
      `NOTE="first\nJWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nsecond"\n` +
      `JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}\n`;
    fs.writeFileSync(envFile, before);
    const res = runLocalEnv();
    expect(res.status).not.toBe(0);
    expect(content()).toBe(before);
  });

  it('appends to a file without a trailing newline whose last line is regenerated', () => {
    fs.writeFileSync(envFile, `PORT=1\nENCRYPTION_KEY=${KEEP}\nJWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(env.PORT).toBe('1');
    expect(env.ENCRYPTION_KEY).toBe(KEEP);
    expect(assignments('JWT_SECRET')).toBe(1);
    const after = content();
    expect(after.endsWith('\n')).toBe(true);
    expect(after).toBe(`PORT=1\nENCRYPTION_KEY=${KEEP}\nJWT_SECRET=${env.JWT_SECRET}\n`);
  });

  it('uses CRLF for the appended line when the file uses CRLF', () => {
    fs.writeFileSync(envFile, `PORT=1\r\nJWT_SECRET=${KEEP}\r\nENCRYPTION_KEY=${PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0]}\r\n`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(env.PORT).toBe('1');
    expect(content()).toBe(`PORT=1\r\nJWT_SECRET=${KEEP}\r\nENCRYPTION_KEY=${env.ENCRYPTION_KEY}\r\n`);
  });

  it('appends a CRLF line to a CRLF file whose last line lacks a final newline', () => {
    fs.writeFileSync(envFile, `PORT=1\r\nJWT_SECRET=${KEEP}\r\nENCRYPTION_KEY=${PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0]}`);
    expect(runLocalEnv().status).toBe(0);
    const env = readEnv();
    expect(env.ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(content()).toBe(`PORT=1\r\nJWT_SECRET=${KEEP}\r\nENCRYPTION_KEY=${env.ENCRYPTION_KEY}\r\n`);
  });

  it('rewrites the target of a symlinked .env and keeps the link', () => {
    const real = path.join(dir, 'real.env');
    fs.writeFileSync(real, `JWT_SECRET=${PLACEHOLDER_SECRETS.JWT_SECRET[0]}\nENCRYPTION_KEY=${KEEP}\n`);
    fs.symlinkSync(real, envFile);
    expect(runLocalEnv().status).toBe(0);
    expect(fs.lstatSync(envFile).isSymbolicLink()).toBe(true);
    const env = readEnv();
    expect(env.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(env.ENCRYPTION_KEY).toBe(KEEP);
    expect(fs.readFileSync(real, 'utf8')).toContain(env.JWT_SECRET);
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
