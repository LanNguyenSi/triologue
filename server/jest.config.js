/**
 * Minimal Jest config wiring up ts-jest. Without this the suite
 * defaults to Babel's parser which can't read TypeScript syntax,
 * and every test file fails with a `Unexpected reserved word
 * 'interface'` style parse error before running.
 *
 * `ts-jest` is already in devDependencies and the project has a
 * `tsconfig.json` it can pick up automatically. Tests live under
 * `src/__tests__/` and follow the `*.test.ts` pattern.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Matches both the central `src/__tests__/` suite and tests that live
  // alongside the module they cover (e.g. integrations/teams/teamsBot.test.ts).
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  // Runs before any test module is imported. Provides the required env
  // vars so the app's startup `validateEnvironment()` does not
  // `process.exit(1)` mid-import. See jest.setup.js.
  setupFiles: ["<rootDir>/jest.setup.js"],
  // Tests are NOT in the main tsconfig include set (rootDir is
  // ./src), but ts-jest only needs them to be ts-parseable so this
  // works without touching tsconfig.json.

  // ── Coverage gate ──────────────────────────────────────────────────────────
  //
  // Per-file thresholds enforce minimum coverage on the CRIT+HIGH server
  // security files (test/triologue-coverage-routes). The global backstop is
  // intentionally low since many service/route files are not yet unit-tested.
  // Thresholds are set a few points below the measured baselines so a small
  // regression still triggers CI failure while minor refactors don't.
  //
  // Measured 2026-06-29 via the full `jest --coverage` suite. Per-file numbers
  // are DB-independent: the RUN_DB_TESTS suites do not import these files, so
  // local (no-DB) and CI (postgres) per-file coverage are identical.
  //   secrets.ts          : Stmts 52.7 | Branch 22.7 | Funcs 50.0 | Lines 52.0
  //   files.ts            : Stmts 58.1 | Branch 44.4 | Funcs 75.0 | Lines 60.6
  //   upload.ts           : Stmts 87.0 | Branch 78.9 | Funcs 83.3 | Lines 87.0
  //   approvals.ts        : Stmts 52.3 | Branch 50.0 | Funcs 33.3 | Lines 55.0
  //   integrationOAuth.ts : Stmts 81.0 | Branch 79.2 | Funcs 75.0 | Lines 81.0
  //   integrations.ts     : Stmts 40.6 | Branch 23.8 | Funcs 37.5 | Lines 40.6
  //   security.ts         : Stmts 85.2 | Branch 73.9 | Funcs 80.0 | Lines 88.2
  //   socketService.ts    : Stmts 63.1 | Branch 50.0 | Funcs 41.7 | Lines 63.1
  // Thresholds are a few points below each measured value. Funcs/branches are
  // capped by the deferred list/GET routes (MED follow-up), not by weak tests —
  // the security guards are mutation-verified. No `global` threshold: on a
  // 166-file server the global aggregate is ~4-20% and CI dilutes it further
  // via index.ts imports, so the per-file gates are the meaningful guard.
  coverageThreshold: {
    // CRIT — secrets ownership + encrypt-on-write
    "./src/routes/secrets.ts": {
      statements: 48,
      branches: 18,
      functions: 45,
      lines: 48,
    },
    // CRIT — files path-traversal + room ACL
    "./src/routes/files.ts": {
      statements: 53,
      branches: 40,
      functions: 70,
      lines: 55,
    },
    // HIGH — upload MIME/size/room ACL
    "./src/routes/upload.ts": {
      statements: 82,
      branches: 74,
      functions: 78,
      lines: 82,
    },
    // HIGH — approvals state-transition (no authz guard, tracked d065de21)
    "./src/routes/approvals.ts": {
      statements: 48,
      branches: 45,
      functions: 30,
      lines: 50,
    },
    // HIGH — integrationOAuth one-time nonce + CLIENT_ID guard
    "./src/services/integrationOAuth.ts": {
      statements: 76,
      branches: 74,
      functions: 70,
      lines: 76,
    },
    // HIGH — integrations ownership + byoa_ rejection
    "./src/routes/integrations.ts": {
      statements: 36,
      branches: 20,
      functions: 33,
      lines: 36,
    },
    // HIGH — plugin capability + workspace/user guards
    "./src/plugins/security.ts": {
      statements: 80,
      branches: 68,
      functions: 75,
      lines: 83,
    },
    // HIGH — socket JWT auth + membership re-check
    "./src/services/socketService.ts": {
      statements: 58,
      branches: 45,
      functions: 37,
      lines: 58,
    },
  },
};
