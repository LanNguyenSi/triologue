// Environment variable validation - fail fast on startup

// Minimum length for the two signing/encryption secrets. The JWT secret signs
// HS256 tokens, whose key should carry at least 256 bits, and the encryption
// key is documented as 32 bytes. `openssl rand -hex 32` (the generator the
// setup docs and `make local-env` use) yields 64 characters.
export const MIN_SECRET_LENGTH = 32;

// The example values shipped in `.env.example` and `server/.env.example`. They
// are public, so a server running with one of them has a known signing or
// encryption key. A test pins this list against both example files, so an
// edited example value cannot drift away from it silently.
export const PLACEHOLDER_SECRETS: Readonly<Record<'JWT_SECRET' | 'ENCRYPTION_KEY', readonly string[]>> = {
  JWT_SECRET: [
    'your-super-secret-jwt-key-change-in-production-make-it-long-and-random',
    'triologue-jwt-secret-key-2026-CHANGE-IN-PRODUCTION',
  ],
  ENCRYPTION_KEY: [
    'your-32-byte-secret-for-secret-encryption',
  ],
};

// The admin password is typed by a person, so it gets a shorter minimum than
// the generated signing and encryption secrets above.
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

// The ADMIN_PASSWORD example in `.env.example`. A copied example would create
// the admin with this published password. A test pins it against the file.
export const PLACEHOLDER_ADMIN_PASSWORDS: readonly string[] = [
  'change_this_secure_password',
];

// The database password in `.env.example` (POSTGRES_PASSWORD and the password
// inside DATABASE_URL). A test pins it against the file.
export const PLACEHOLDER_DATABASE_PASSWORDS: readonly string[] = [
  'triologue_secure_password_change_me',
];

// Returns the reason the seed must not create the admin with this
// ADMIN_PASSWORD, or null when the value is acceptable. The reason names the
// variable and the rule, never the value. An unset or blank value is refused
// too: the seed used to fall back to a built-in password.
export const findWeakAdminPassword = (env: NodeJS.ProcessEnv): string | null => {
  const value = env.ADMIN_PASSWORD?.trim();
  if (!value) return 'ADMIN_PASSWORD is not set';
  if (PLACEHOLDER_ADMIN_PASSWORDS.includes(value)) {
    return 'ADMIN_PASSWORD is still the placeholder value from .env.example';
  }
  if (value.length < MIN_ADMIN_PASSWORD_LENGTH) {
    return `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`;
  }
  return null;
};

// Returns the names of the variables whose database password is still the
// example value. Looks at the password inside DATABASE_URL (the one the server
// connects with) and at POSTGRES_PASSWORD (the one a compose `env_file` also
// hands to the api container). Never returns or logs a value, and a DATABASE_URL
// that does not parse is skipped, not an error: Prisma reports it on first use.
export const findPlaceholderDatabasePasswords = (env: NodeJS.ProcessEnv): string[] => {
  const sources: string[] = [];

  const fromUrl = env.DATABASE_URL?.trim();
  if (fromUrl) {
    try {
      const password = decodeURIComponent(new URL(fromUrl).password);
      if (PLACEHOLDER_DATABASE_PASSWORDS.includes(password)) sources.push('DATABASE_URL');
    } catch {
      // Malformed URL or bad percent-encoding: nothing to compare.
    }
  }

  const fromEnv = env.POSTGRES_PASSWORD?.trim();
  if (fromEnv && PLACEHOLDER_DATABASE_PASSWORDS.includes(fromEnv)) {
    sources.push('POSTGRES_PASSWORD');
  }

  return sources;
};

// Returns one reason per rejected secret. The reason names the variable and the
// rule, never the value.
export const findWeakSecrets = (env: NodeJS.ProcessEnv): string[] => {
  const problems: string[] = [];
  for (const key of Object.keys(PLACEHOLDER_SECRETS) as Array<keyof typeof PLACEHOLDER_SECRETS>) {
    const value = env[key]?.trim();
    // An unset value, or one that is empty after trimming, is reported by the
    // required-variable check in validateEnvironment (which trims too).
    if (!value) continue;
    if (PLACEHOLDER_SECRETS[key].includes(value)) {
      problems.push(`${key} is still the placeholder value from .env.example`);
    } else if (value.length < MIN_SECRET_LENGTH) {
      problems.push(`${key} is shorter than ${MIN_SECRET_LENGTH} characters`);
    }
  }
  return problems;
};

export const validateEnvironment = () => {
  const required = [
    'JWT_SECRET',
    'DATABASE_URL',
    'ENCRYPTION_KEY',
  ];

  const optional = [
    'GITHUB_WEBHOOK_SECRET',
    'REDIS_URL',
    'CLIENT_URL',
    'PORT',
    // OAuth integrations are opt-in; tokenManager already throws at first use
    // if absent, so a startup warning gives early visibility without breaking
    // deployments that do not use integrations.
    'INTEGRATION_ENCRYPTION_KEY',
  ];

  // A whitespace-only value counts as missing: it would otherwise be accepted
  // here and skipped by findWeakSecrets, leaving an effectively empty secret.
  const missing = required.filter(key => !process.env[key]?.trim());

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\n💡 Copy .env.example to .env and fill in the values');
    process.exit(1);
  }

  const weak = findWeakSecrets(process.env);
  if (weak.length > 0) {
    console.error('❌ Insecure secrets:');
    weak.forEach(problem => console.error(`   - ${problem}`));
    console.error('\n💡 Generate real values, e.g. `openssl rand -hex 32`, or run `make local-env` for a local setup');
    process.exit(1);
  }

  // Advisory only: an existing Postgres volume keeps the password it was first
  // created with, so refusing to start would break installs that still use the
  // example value. One warning per start, naming the variables, never the value.
  const placeholderDb = findPlaceholderDatabasePasswords(process.env);
  if (placeholderDb.length > 0) {
    console.warn(
      `⚠️  The database password in ${placeholderDb.join(' and ')} is still the example value from .env.example. ` +
        'Change it in Postgres (ALTER USER) and in .env together; an existing Postgres volume keeps its first password, so editing .env alone breaks the connection.',
    );
  }

  console.log('✅ Environment validation passed');
  
  // Log optional variables that are missing (warnings, not errors)
  const missingOptional = optional.filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn('⚠️  Optional environment variables not set:');
    missingOptional.forEach(key => console.warn(`   - ${key} (using default)`));
  }
};
