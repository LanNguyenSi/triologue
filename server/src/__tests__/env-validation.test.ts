/**
 * validateEnvironment rejects weak JWT_SECRET / ENCRYPTION_KEY values.
 *
 * Branches covered:
 *   1. a value equal to a placeholder shipped in an .env.example file
 *   2. a value shorter than MIN_SECRET_LENGTH
 *   3. a long, non-placeholder value passes
 *   4. the placeholder list is pinned against both .env.example files
 *   5. the error output names the variable and never prints the value
 *   6. an empty or whitespace-only required secret fails startup
 *   7. findWeakAdminPassword refuses a missing, blank, example or short ADMIN_PASSWORD
 *   8. validateEnvironment warns once when the database password is the example value
 *   9. the admin and database placeholders are pinned against .env.example
 *  10. decideAdminPasswordAction refuses for an absent admin and only warns for an existing one
 *
 * There is deliberately no NODE_ENV bypass: the test environment passes
 * because jest.setup.js supplies non-placeholder values of sufficient length.
 */
import fs from 'fs';
import path from 'path';
import {
  validateEnvironment,
  findWeakSecrets,
  findWeakAdminPassword,
  decideAdminPasswordAction,
  findPlaceholderDatabasePasswords,
  MIN_SECRET_LENGTH,
  MIN_ADMIN_PASSWORD_LENGTH,
  PLACEHOLDER_SECRETS,
  PLACEHOLDER_ADMIN_PASSWORDS,
  PLACEHOLDER_DATABASE_PASSWORDS,
} from '../utils/env-validation';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE_FILES = ['.env.example', 'server/.env.example'];

/** Reads KEY=value from an example file, stripping optional surrounding quotes. */
function exampleValue(file: string, key: string): string | undefined {
  const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!match) return undefined;
  return match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
}

const GOOD_JWT = 'j'.repeat(MIN_SECRET_LENGTH);
const GOOD_KEY = 'k'.repeat(MIN_SECRET_LENGTH);

describe('findWeakSecrets', () => {
  const base = { JWT_SECRET: GOOD_JWT, ENCRYPTION_KEY: GOOD_KEY };

  it('accepts long non-placeholder values for both secrets', () => {
    expect(findWeakSecrets(base)).toEqual([]);
  });

  it('accepts a value of exactly the minimum length', () => {
    expect(findWeakSecrets({ ...base, JWT_SECRET: 'x'.repeat(MIN_SECRET_LENGTH) })).toEqual([]);
  });

  it('rejects a value one character below the minimum length', () => {
    const short = 'x'.repeat(MIN_SECRET_LENGTH - 1);
    expect(findWeakSecrets({ ...base, JWT_SECRET: short })).toEqual([
      `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`,
    ]);
    expect(findWeakSecrets({ ...base, ENCRYPTION_KEY: short })).toEqual([
      `ENCRYPTION_KEY is shorter than ${MIN_SECRET_LENGTH} characters`,
    ]);
  });

  it('rejects every JWT_SECRET placeholder, even though they are long enough', () => {
    for (const placeholder of PLACEHOLDER_SECRETS.JWT_SECRET) {
      expect(placeholder.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
      expect(findWeakSecrets({ ...base, JWT_SECRET: placeholder })).toEqual([
        'JWT_SECRET is still the placeholder value from .env.example',
      ]);
    }
  });

  it('rejects every ENCRYPTION_KEY placeholder, even though they are long enough', () => {
    for (const placeholder of PLACEHOLDER_SECRETS.ENCRYPTION_KEY) {
      expect(placeholder.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
      expect(findWeakSecrets({ ...base, ENCRYPTION_KEY: placeholder })).toEqual([
        'ENCRYPTION_KEY is still the placeholder value from .env.example',
      ]);
    }
  });

  it('ignores surrounding whitespace when matching a placeholder', () => {
    const placeholder = PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0];
    expect(findWeakSecrets({ ...base, ENCRYPTION_KEY: `  ${placeholder}\n` })).toHaveLength(1);
  });

  it('reports each weak secret separately when both are weak', () => {
    expect(
      findWeakSecrets({
        JWT_SECRET: PLACEHOLDER_SECRETS.JWT_SECRET[0],
        ENCRYPTION_KEY: 'short',
      }),
    ).toEqual([
      'JWT_SECRET is still the placeholder value from .env.example',
      `ENCRYPTION_KEY is shorter than ${MIN_SECRET_LENGTH} characters`,
    ]);
  });

  it('reports nothing for unset or blank values; validateEnvironment rejects those as missing', () => {
    expect(findWeakSecrets({})).toEqual([]);
    expect(findWeakSecrets({ JWT_SECRET: '', ENCRYPTION_KEY: '   ' })).toEqual([]);
  });
});

describe('placeholder list is pinned against the .env.example files', () => {
  const keys = Object.keys(PLACEHOLDER_SECRETS) as Array<keyof typeof PLACEHOLDER_SECRETS>;

  for (const file of EXAMPLE_FILES) {
    for (const key of keys) {
      it(`${file} ${key} value is in the placeholder list and rejected`, () => {
        const value = exampleValue(file, key);
        expect(value).toBeTruthy();
        expect(PLACEHOLDER_SECRETS[key]).toContain(value);
        const env = { JWT_SECRET: GOOD_JWT, ENCRYPTION_KEY: GOOD_KEY, [key]: value };
        expect(findWeakSecrets(env)).toHaveLength(1);
      });
    }
  }

  it('every placeholder in the list still appears in an .env.example file', () => {
    for (const key of keys) {
      const live = EXAMPLE_FILES.map(file => exampleValue(file, key));
      for (const placeholder of PLACEHOLDER_SECRETS[key]) {
        expect(live).toContain(placeholder);
      }
    }
  });
});

describe('validateEnvironment', () => {
  const SAVED = { ...process.env };
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => { /* no-op: mock stub to suppress process.exit during tests */ }) as (code?: string | number | null) => never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* no-op: capture output */ });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => { /* no-op: suppress console output during tests */ });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* no-op: suppress console output during tests */ });
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.JWT_SECRET = GOOD_JWT;
    process.env.ENCRYPTION_KEY = GOOD_KEY;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.DATABASE_URL = SAVED.DATABASE_URL;
    process.env.JWT_SECRET = SAVED.JWT_SECRET;
    process.env.ENCRYPTION_KEY = SAVED.ENCRYPTION_KEY;
  });

  const errorOutput = () => errorSpy.mock.calls.map(call => call.join(' ')).join('\n');

  it('passes with long non-placeholder secrets', () => {
    validateEnvironment();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits when JWT_SECRET is a placeholder, names the variable, and does not print the value', () => {
    const placeholder = PLACEHOLDER_SECRETS.JWT_SECRET[0];
    process.env.JWT_SECRET = placeholder;
    validateEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain('JWT_SECRET');
    expect(errorOutput()).not.toContain(placeholder);
  });

  it('exits when ENCRYPTION_KEY is a placeholder, names the variable, and does not print the value', () => {
    const placeholder = PLACEHOLDER_SECRETS.ENCRYPTION_KEY[0];
    process.env.ENCRYPTION_KEY = placeholder;
    validateEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain('ENCRYPTION_KEY');
    expect(errorOutput()).not.toContain(placeholder);
  });

  it('exits when JWT_SECRET is too short and does not print the value', () => {
    const short = 'short-secret-value';
    process.env.JWT_SECRET = short;
    validateEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain('JWT_SECRET');
    expect(errorOutput()).not.toContain(short);
  });

  it('exits when ENCRYPTION_KEY is too short and does not print the value', () => {
    const short = 'short-key-value';
    process.env.ENCRYPTION_KEY = short;
    validateEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain('ENCRYPTION_KEY');
    expect(errorOutput()).not.toContain(short);
  });

  const BLANK_VALUES: Array<[string, string]> = [
    ['empty', ''],
    ['spaces only', '   '],
    ['tab and newline only', '\t\n'],
  ];

  for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY'] as const) {
    for (const [label, blank] of BLANK_VALUES) {
      it(`exits when ${key} is ${label} and names the variable`, () => {
        process.env[key] = blank;
        validateEnvironment();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorOutput()).toContain(key);
        expect(errorOutput()).toContain('Missing required environment variables');
      });
    }
  }

  it('does not treat a value with surrounding whitespace as blank', () => {
    process.env.JWT_SECRET = `  ${GOOD_JWT}  `;
    validateEnvironment();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('still rejects placeholders when NODE_ENV is test (no bypass)', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = PLACEHOLDER_SECRETS.JWT_SECRET[1];
    validateEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('findWeakAdminPassword', () => {
  const STRONG = 'a-strong-admin-pass-1';

  it('accepts a strong value', () => {
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: STRONG })).toBeNull();
  });

  it('uses a minimum of 12 characters, the number the docs state', () => {
    expect(MIN_ADMIN_PASSWORD_LENGTH).toBe(12);
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: 'x'.repeat(11) })).not.toBeNull();
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: 'x'.repeat(12) })).toBeNull();
  });

  it('accepts a value of exactly the minimum length and refuses one character less', () => {
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH) })).toBeNull();
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1) })).toBe(
      `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
    );
  });

  it('refuses the example value, even though it is long enough', () => {
    for (const placeholder of PLACEHOLDER_ADMIN_PASSWORDS) {
      expect(placeholder.length).toBeGreaterThanOrEqual(MIN_ADMIN_PASSWORD_LENGTH);
      expect(findWeakAdminPassword({ ADMIN_PASSWORD: placeholder })).toBe(
        'ADMIN_PASSWORD is still the placeholder value from .env.example',
      );
    }
  });

  it('refuses the example value padded with whitespace', () => {
    const placeholder = PLACEHOLDER_ADMIN_PASSWORDS[0];
    for (const padded of [` ${placeholder}`, `${placeholder} `, `\t${placeholder}\n`]) {
      expect(findWeakAdminPassword({ ADMIN_PASSWORD: padded })).toBe(
        'ADMIN_PASSWORD is still the placeholder value from .env.example',
      );
    }
  });

  it('refuses a value that is long only because of padding', () => {
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: `      short      ` })).toBe(
      `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
    );
  });

  it('refuses an unset, empty or whitespace-only value (no built-in fallback)', () => {
    expect(findWeakAdminPassword({})).toBe('ADMIN_PASSWORD is not set');
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: '' })).toBe('ADMIN_PASSWORD is not set');
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: '  \t ' })).toBe('ADMIN_PASSWORD is not set');
  });

  it('never puts the value in the reason', () => {
    for (const value of [PLACEHOLDER_ADMIN_PASSWORDS[0], 'tiny-secret', ` ${PLACEHOLDER_ADMIN_PASSWORDS[0]} `]) {
      expect(findWeakAdminPassword({ ADMIN_PASSWORD: value })).not.toContain(value.trim());
    }
  });
});

describe('decideAdminPasswordAction', () => {
  const STRONG = 'a-strong-admin-pass-1';
  const PLACEHOLDER = PLACEHOLDER_ADMIN_PASSWORDS[0];
  const SHORT = 'x'.repeat(MIN_ADMIN_PASSWORD_LENGTH - 1);

  it('proceeds for a strong value, whether or not the admin exists', () => {
    expect(decideAdminPasswordAction({ ADMIN_PASSWORD: STRONG }, false)).toEqual({ action: 'proceed' });
    expect(decideAdminPasswordAction({ ADMIN_PASSWORD: STRONG }, true)).toEqual({ action: 'proceed' });
  });

  it('refuses every weak or unset value when the admin does not exist yet', () => {
    for (const value of [PLACEHOLDER, ` ${PLACEHOLDER}\n`, SHORT, '', '   ', undefined]) {
      const decision = decideAdminPasswordAction({ ADMIN_PASSWORD: value }, false);
      expect(decision.action).toBe('refuse');
    }
    expect(decideAdminPasswordAction({}, false).action).toBe('refuse');
  });

  it('warns for a set but weak value when the admin already exists', () => {
    for (const value of [PLACEHOLDER, ` ${PLACEHOLDER}\n`, SHORT]) {
      expect(decideAdminPasswordAction({ ADMIN_PASSWORD: value }, true).action).toBe('warn');
    }
  });

  it('proceeds silently for an unset or blank value when the admin already exists', () => {
    for (const value of ['', '   ', undefined]) {
      expect(decideAdminPasswordAction({ ADMIN_PASSWORD: value }, true)).toEqual({ action: 'proceed' });
    }
    expect(decideAdminPasswordAction({}, true)).toEqual({ action: 'proceed' });
  });

  it('never puts the value in a message', () => {
    for (const exists of [false, true]) {
      for (const value of [PLACEHOLDER, ` ${PLACEHOLDER} `, SHORT]) {
        const decision = decideAdminPasswordAction({ ADMIN_PASSWORD: value }, exists);
        expect(decision.action).not.toBe('proceed');
        expect((decision as { message: string }).message).not.toContain(value.trim());
      }
    }
  });
});

describe('findPlaceholderDatabasePasswords', () => {
  const PLACEHOLDER = PLACEHOLDER_DATABASE_PASSWORDS[0];
  const url = (password: string) => `postgresql://triologue_user:${password}@postgres:5432/triologue`;

  it('reports nothing for a real password in both variables', () => {
    expect(
      findPlaceholderDatabasePasswords({ DATABASE_URL: url('r3al-pass'), POSTGRES_PASSWORD: 'r3al-pass' }),
    ).toEqual([]);
  });

  it('reports nothing when neither variable is set', () => {
    expect(findPlaceholderDatabasePasswords({})).toEqual([]);
  });

  it('reports DATABASE_URL when only its password is the example value', () => {
    expect(findPlaceholderDatabasePasswords({ DATABASE_URL: url(PLACEHOLDER), POSTGRES_PASSWORD: 'real' })).toEqual([
      'DATABASE_URL',
    ]);
  });

  it('reports POSTGRES_PASSWORD when only it is the example value', () => {
    expect(findPlaceholderDatabasePasswords({ DATABASE_URL: url('real'), POSTGRES_PASSWORD: PLACEHOLDER })).toEqual([
      'POSTGRES_PASSWORD',
    ]);
  });

  it('reports both when both are the example value, and ignores whitespace in POSTGRES_PASSWORD', () => {
    expect(
      findPlaceholderDatabasePasswords({ DATABASE_URL: url(PLACEHOLDER), POSTGRES_PASSWORD: ` ${PLACEHOLDER}\n` }),
    ).toEqual(['DATABASE_URL', 'POSTGRES_PASSWORD']);
  });

  it('decodes a percent-encoded password before comparing', () => {
    const encoded = PLACEHOLDER.replace('_', '%5F');
    expect(encoded).not.toBe(PLACEHOLDER);
    expect(findPlaceholderDatabasePasswords({ DATABASE_URL: url(encoded) })).toEqual(['DATABASE_URL']);
  });

  it('does not throw on a malformed DATABASE_URL or bad percent-encoding', () => {
    for (const bad of ['not a url', 'postgresql://', 'postgresql://u:%E0%A4%A@h/db', ':::']) {
      expect(() => findPlaceholderDatabasePasswords({ DATABASE_URL: bad })).not.toThrow();
      expect(findPlaceholderDatabasePasswords({ DATABASE_URL: bad })).toEqual([]);
    }
  });
});

describe('validateEnvironment database password warning', () => {
  const SAVED = { ...process.env };
  const PLACEHOLDER = PLACEHOLDER_DATABASE_PASSWORDS[0];
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => { /* no-op: mock stub to suppress process.exit during tests */ }) as (code?: string | number | null) => never);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* no-op: capture output */ });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => { /* no-op: capture output */ });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* no-op: capture output */ });
    process.env.JWT_SECRET = GOOD_JWT;
    process.env.ENCRYPTION_KEY = GOOD_KEY;
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    delete process.env.POSTGRES_PASSWORD;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL', 'POSTGRES_PASSWORD']) {
      if (SAVED[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED[key];
    }
  });

  const dbWarnings = () =>
    warnSpy.mock.calls.map(call => call.join(' ')).filter(line => line.includes('database password'));
  const allOutput = () =>
    [errorSpy, logSpy, warnSpy].flatMap(spy => spy.mock.calls.map(call => call.join(' '))).join('\n');

  it('does not warn for a real database password and still passes', () => {
    process.env.DATABASE_URL = 'postgresql://triologue_user:r3al-pass@postgres:5432/triologue';
    process.env.POSTGRES_PASSWORD = 'r3al-pass';
    validateEnvironment();
    expect(dbWarnings()).toHaveLength(0);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('warns once, names DATABASE_URL, never prints the value, and does not exit', () => {
    process.env.DATABASE_URL = `postgresql://triologue_user:${PLACEHOLDER}@postgres:5432/triologue`;
    validateEnvironment();
    expect(dbWarnings()).toHaveLength(1);
    expect(dbWarnings()[0]).toContain('DATABASE_URL');
    expect(allOutput()).not.toContain(PLACEHOLDER);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('warns once, naming both variables, when both carry the example value', () => {
    process.env.DATABASE_URL = `postgresql://triologue_user:${PLACEHOLDER}@postgres:5432/triologue`;
    process.env.POSTGRES_PASSWORD = PLACEHOLDER;
    validateEnvironment();
    expect(dbWarnings()).toHaveLength(1);
    expect(dbWarnings()[0]).toContain('DATABASE_URL and POSTGRES_PASSWORD');
    expect(allOutput()).not.toContain(PLACEHOLDER);
  });

  it('warns for POSTGRES_PASSWORD alone', () => {
    process.env.POSTGRES_PASSWORD = PLACEHOLDER;
    validateEnvironment();
    expect(dbWarnings()).toHaveLength(1);
    expect(dbWarnings()[0]).toContain('POSTGRES_PASSWORD');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does not crash startup on a malformed DATABASE_URL', () => {
    process.env.DATABASE_URL = 'not a url at all';
    expect(() => validateEnvironment()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(dbWarnings()).toHaveLength(0);
  });
});

describe('admin and database placeholders are pinned against .env.example', () => {
  it('ADMIN_PASSWORD in .env.example is in the placeholder list and refused', () => {
    const value = exampleValue('.env.example', 'ADMIN_PASSWORD');
    expect(value).toBeTruthy();
    expect(PLACEHOLDER_ADMIN_PASSWORDS).toContain(value);
    expect(findWeakAdminPassword({ ADMIN_PASSWORD: value })).not.toBeNull();
  });

  it('every admin placeholder still appears in .env.example', () => {
    for (const placeholder of PLACEHOLDER_ADMIN_PASSWORDS) {
      expect(exampleValue('.env.example', 'ADMIN_PASSWORD')).toBe(placeholder);
    }
  });

  it('POSTGRES_PASSWORD in .env.example is in the database placeholder list', () => {
    expect(PLACEHOLDER_DATABASE_PASSWORDS).toContain(exampleValue('.env.example', 'POSTGRES_PASSWORD'));
  });

  it('the password inside DATABASE_URL in .env.example is in the database placeholder list and warns', () => {
    const raw = exampleValue('.env.example', 'DATABASE_URL');
    expect(raw).toBeTruthy();
    const password = decodeURIComponent(new URL(raw as string).password);
    expect(PLACEHOLDER_DATABASE_PASSWORDS).toContain(password);
    expect(findPlaceholderDatabasePasswords({ DATABASE_URL: raw })).toEqual(['DATABASE_URL']);
  });

  it('every database placeholder still appears in .env.example', () => {
    for (const placeholder of PLACEHOLDER_DATABASE_PASSWORDS) {
      expect(exampleValue('.env.example', 'POSTGRES_PASSWORD')).toBe(placeholder);
    }
  });
});
