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

  console.log('✅ Environment validation passed');
  
  // Log optional variables that are missing (warnings, not errors)
  const missingOptional = optional.filter(key => !process.env[key]);
  if (missingOptional.length > 0) {
    console.warn('⚠️  Optional environment variables not set:');
    missingOptional.forEach(key => console.warn(`   - ${key} (using default)`));
  }
};
