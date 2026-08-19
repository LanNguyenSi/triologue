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
  // Measured 2026-06-29 via the full `jest --coverage` suite; secrets.ts,
  // files.ts, upload.ts, and the four newly-added entries below were
  // re-measured 2026-08-19 (task dfadd56b, follow-up to PR #168) after
  // adding tests for the BYOA agent-token auth path + ?token= query
  // fallback (files.ts), the linked-project-closed write block (upload.ts),
  // the POST/PUT project-ownership guard (secrets.ts), and new coverage for
  // byoaAuth.ts, errorHandler.ts, mentionLimiter.ts, and
  // actionRegistry.ts's buildPermittedConnectorActions. Per-file numbers
  // are DB-independent: the RUN_DB_TESTS suites do not import these files,
  // so local (no-DB) and CI (postgres) per-file coverage are identical.
  //   secrets.ts          : Stmts 59.8 | Branch 37.9 | Funcs 50.0 | Lines 59.8  (was 52.7/22.7/50.0/52.0)
  //   files.ts            : Stmts 67.6 | Branch 61.1 | Funcs 75.0 | Lines 70.4  (was 58.1/44.4/75.0/60.6)
  //   upload.ts           : Stmts 89.9 | Branch 84.2 | Funcs 83.3 | Lines 89.9  (was 87.0/78.9/83.3/87.0)
  //   approvals.ts        : Stmts 52.3 | Branch 50.0 | Funcs 33.3 | Lines 55.0
  //   integrationOAuth.ts : Stmts 81.0 | Branch 79.2 | Funcs 75.0 | Lines 81.0
  //   integrations.ts     : Stmts 40.6 | Branch 23.8 | Funcs 37.5 | Lines 40.6
  //   security.ts         : Stmts 85.2 | Branch 73.9 | Funcs 80.0 | Lines 88.2
  //   socketService.ts    : Stmts 63.1 | Branch 50.0 | Funcs 41.7 | Lines 63.1
  //   byoaAuth.ts         : Stmts 100  | Branch 100  | Funcs 100  | Lines 100  (new)
  //   errorHandler.ts     : Stmts 100  | Branch 100  | Funcs 100  | Lines 100  (new)
  //   mentionLimiter.ts   : Stmts 97.7 | Branch 90.9 | Funcs 100  | Lines 97.7 (new)
  //   actionRegistry.ts   : Stmts 55.8 | Branch 23.8 | Funcs 20.0 | Lines 52.5 (new; only
  //     buildPermittedConnectorActions is covered — buildActionsForTask and
  //     buildConnectorActions remain untested, tracked as a MED follow-up gap)
  // Thresholds are a few points below each measured value. Funcs/branches are
  // capped by the deferred list/GET routes (MED follow-up), not by weak tests —
  // the security guards are mutation-verified. No `global` threshold: on a
  // 166-file server the global aggregate is ~4-20% and CI dilutes it further
  // via index.ts imports, so the per-file gates are the meaningful guard.
  coverageThreshold: {
    // CRIT — secrets ownership + encrypt-on-write + project-ownership guard
    "./src/routes/secrets.ts": {
      statements: 55,
      branches: 33,
      functions: 45,
      lines: 55,
    },
    // CRIT — files path-traversal + room ACL + BYOA auth + ?token= fallback
    "./src/routes/files.ts": {
      statements: 62,
      branches: 56,
      functions: 70,
      lines: 65,
    },
    // HIGH — upload MIME/size/room ACL + linked-project-closed write block
    "./src/routes/upload.ts": {
      statements: 85,
      branches: 79,
      functions: 78,
      lines: 85,
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
    // MED — BYOA bearer-token resolution + pending/rejected/deactivated guards
    "./src/middleware/byoaAuth.ts": {
      statements: 95,
      branches: 90,
      functions: 95,
      lines: 95,
    },
    // MED — production error-message leakage + stack-trace exposure guard
    "./src/middleware/errorHandler.ts": {
      statements: 95,
      branches: 90,
      functions: 95,
      lines: 95,
    },
    // MED — daily mention-limit off-by-one boundary + reset + warning threshold
    "./src/services/mentionLimiter.ts": {
      statements: 92,
      branches: 85,
      functions: 95,
      lines: 92,
    },
    // MED — per-connector permission allowlist (buildPermittedConnectorActions only;
    // buildActionsForTask/buildConnectorActions remain untested, MED follow-up)
    "./src/services/actionRegistry.ts": {
      statements: 50,
      branches: 18,
      functions: 15,
      lines: 47,
    },
  },
};
