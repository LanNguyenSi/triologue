// Test environment defaults, applied before any test module is imported.
//
// `src/index.ts` runs `validateEnvironment()` at import time, which calls
// `process.exit(1)` when a required variable is missing. Test files that
// `import { app } from '../index'` would therefore crash the whole jest
// worker before a single test runs. Providing the required variables here
// (via `setupFiles`, which runs before test modules are loaded) lets the
// app import cleanly.
//
// Existing values are never overridden: an operator running the gated DB
// integration suite (RUN_DB_TESTS=1) can point DATABASE_URL at a real test
// database and these defaults step aside.
process.env.NODE_ENV ||= "test";
process.env.JWT_SECRET ||= "test-jwt-secret-key";
process.env.ENCRYPTION_KEY ||= "test-encryption-key-000000000000";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/triologue_test";
process.env.ICE_TOKEN ||= "test-ice-token";
process.env.LAVA_TOKEN ||= "test-lava-token";
// The DB integration suite registers human users without invite codes, so the
// gated suite runs with open registration (production sets this explicitly).
process.env.REGISTRATION_MODE ||= "open";
