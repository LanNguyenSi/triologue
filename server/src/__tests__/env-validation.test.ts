/**
 * validateEnvironment rejects weak JWT_SECRET / ENCRYPTION_KEY values.
 *
 * Branches covered:
 *   1. a value equal to a placeholder shipped in an .env.example file
 *   2. a value shorter than MIN_SECRET_LENGTH
 *   3. a long, non-placeholder value passes
 *   4. the placeholder list is pinned against both .env.example files
 *   5. the error output names the variable and never prints the value
 *
 * There is deliberately no NODE_ENV bypass: the test environment passes
 * because jest.setup.js supplies non-placeholder values of sufficient length.
 */
import fs from 'fs';
import path from 'path';
import {
  validateEnvironment,
  findWeakSecrets,
  MIN_SECRET_LENGTH,
  PLACEHOLDER_SECRETS,
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

  it('leaves unset or empty values to the required-variable check', () => {
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

  it('still rejects placeholders when NODE_ENV is test (no bypass)', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = PLACEHOLDER_SECRETS.JWT_SECRET[1];
    validateEnvironment();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
