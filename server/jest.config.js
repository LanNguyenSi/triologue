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
  // Measured baselines (2026-06-29, run with --testPathPattern on the 7 new
  // test files):
  //   secrets.ts         : Stmts 49 | Branch 72 | Funcs 100 | Lines 49
  //   files.ts           : Stmts 71 | Branch 68 | Funcs  50 | Lines 71
  //   upload.ts          : Stmts 92 | Branch 80 | Funcs 100 | Lines 92
  //   approvals.ts       : Stmts 71 | Branch 82 | Funcs 100 | Lines 71
  //   integrationOAuth.ts: Stmts 91 | Branch 81 | Funcs 100 | Lines 91
  //   integrations.ts    : Stmts 42 | Branch 50 | Funcs 100 | Lines 42
  //   security.ts        : Stmts 91 | Branch 85 | Funcs  75 | Lines 91
  //   socketService.ts   : Stmts 61 | Branch 76 | Funcs 100 | Lines 61
  coverageThreshold: {
    global: {
      statements: 5,
      branches: 5,
      functions: 5,
      lines: 5,
    },
    // CRIT — secrets ownership + encrypt-on-write
    "./src/routes/secrets.ts": {
      statements: 45,
      branches: 65,
      functions: 95,
      lines: 45,
    },
    // CRIT — files path-traversal + room ACL
    "./src/routes/files.ts": {
      statements: 65,
      branches: 60,
      functions: 45,
      lines: 65,
    },
    // HIGH — upload MIME/size/room ACL
    "./src/routes/upload.ts": {
      statements: 87,
      branches: 75,
      functions: 95,
      lines: 87,
    },
    // HIGH — approvals state-transition (no authz guard, tracked d065de21)
    "./src/routes/approvals.ts": {
      statements: 65,
      branches: 75,
      functions: 95,
      lines: 65,
    },
    // HIGH — integrationOAuth one-time nonce + CLIENT_ID guard
    "./src/services/integrationOAuth.ts": {
      statements: 85,
      branches: 75,
      functions: 95,
      lines: 85,
    },
    // HIGH — integrations ownership + byoa_ rejection
    "./src/routes/integrations.ts": {
      statements: 35,
      branches: 45,
      functions: 95,
      lines: 35,
    },
    // HIGH — plugin capability + workspace/user guards
    "./src/plugins/security.ts": {
      statements: 85,
      branches: 80,
      functions: 70,
      lines: 85,
    },
    // HIGH — socket JWT auth + membership re-check
    "./src/services/socketService.ts": {
      statements: 55,
      branches: 70,
      functions: 95,
      lines: 55,
    },
  },
};
