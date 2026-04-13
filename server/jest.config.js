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
  testMatch: ["**/__tests__/**/*.test.ts"],
  // Tests are NOT in the main tsconfig include set (rootDir is
  // ./src), but ts-jest only needs them to be ts-parseable so this
  // works without touching tsconfig.json.
};
