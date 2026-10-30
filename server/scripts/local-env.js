#!/usr/bin/env node
// Ensure the local .env holds real JWT_SECRET / ENCRYPTION_KEY values.
//
// The file is read with the server's own dotenv, so every assignment form
// dotenv accepts (VAR=value, indented, export VAR=value, VAR = value,
// VAR: value, quoted values, a trailing # comment) is understood, and the
// last assignment of a repeated variable wins. A variable is regenerated
// when its effective value is missing, empty or whitespace-only, or equal
// to the value the root .env.example ships.
//
// Multi-line quoted values of other variables (a PEM key, a two-line note)
// are kept byte for byte: the old view of the file is dotenv's parse of the
// whole file, so such a value survives the rewrite untouched. The script
// refuses only when the regenerated variable itself cannot be mapped to
// single lines, and then names it and the manual step. As a safety net the
// rewritten content must still parse back to exactly the old view (plus the
// new secret) before anything is written.
//
// Usage: node local-env.js <env-file> VAR [VAR...]
// LOCAL_ENV_DOTENV_MODULE overrides the module id used to load dotenv
// (tests point it at a non-existent path to simulate a missing install).
'use strict';

let dotenv;
try {
  dotenv = require(process.env.LOCAL_ENV_DOTENV_MODULE || 'dotenv');
} catch {
  console.error('dotenv is not installed. Run `npm --prefix server ci` first.');
  process.exit(1);
}

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXAMPLE_FILE = path.resolve(__dirname, '..', '..', '.env.example');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const [envFile, ...vars] = process.argv.slice(2);
if (!envFile || vars.length === 0) {
  fail('usage: local-env.js <env-file> VAR [VAR...]');
}
if (!fs.existsSync(envFile)) {
  fail(`${envFile} does not exist`);
}

// The file read line by line: every line dotenv reads as one assignment
// contributes its value, so the last assignment of a key wins. For a variable
// that is only assigned on single lines this agrees with dotenv's whole-file
// parse; when it does not, one of the assignment lines sits inside another
// variable's multi-line quoted value.
function lineValues(text) {
  const values = Object.create(null);
  for (const line of text.split('\n')) {
    const parsed = dotenv.parse(line);
    for (const key of Object.keys(parsed)) {
      values[key] = parsed[key];
    }
  }
  return values;
}

// True when the line, read on its own by dotenv, assigns exactly this
// variable. dotenv's key capture is the whole token, so JWT_SECRET_OLD or
// MY_JWT_SECRET never match JWT_SECRET.
function assigns(line, name) {
  const keys = Object.keys(dotenv.parse(line));
  return keys.length === 1 && keys[0] === name;
}

const original = fs.readFileSync(envFile, 'utf8');
// Appended lines use the line ending the file already has.
const EOL = original.includes('\r\n') ? '\r\n' : '\n';
let placeholders = Object.create(null);
try {
  placeholders = dotenv.parse(fs.readFileSync(EXAMPLE_FILE, 'utf8'));
} catch {
  fail(`cannot read ${EXAMPLE_FILE} to compare placeholders`);
}

// The old view of the file is dotenv's parse of the whole file, so an
// unrelated multi-line quoted value is part of it and must survive.
const current = dotenv.parse(original);
const lineView = lineValues(original);

// A variable is regenerated when its effective value is missing, blank or
// still the placeholder from .env.example. Never log the value itself.
const regenerated = Object.create(null);
for (const name of vars) {
  const value = current[name];
  if (value === undefined || !value.trim()) {
    regenerated[name] = crypto.randomBytes(32).toString('hex');
    continue;
  }
  const placeholder = placeholders[name];
  if (placeholder !== undefined && value.trim() === placeholder.trim()) {
    regenerated[name] = crypto.randomBytes(32).toString('hex');
  }
}

const names = Object.keys(regenerated);
if (names.length === 0) process.exit(0);

// A regenerated variable must map to single-line assignments, or its own
// lines cannot be removed safely. Refuse and name the manual step.
for (const name of names) {
  const value = current[name];
  if (value !== undefined && value.includes('\n')) {
    fail(`${envFile}: ${name} could not be rewritten safely because its value spans multiple lines; add a line ${name}=<64 hex chars> yourself; .env left untouched`);
  }
  if (lineView[name] !== value) {
    fail(`${envFile}: ${name} could not be rewritten safely because one of its assignments sits inside a multi-line quoted value; add a line ${name}=<64 hex chars> yourself; .env left untouched`);
  }
}

// Rewrite: drop every line that assigns a regenerated variable, then append
// the new value last (the last assignment wins). All other lines survive
// byte for byte.
let text = original;
for (const name of names) {
  const kept = text.split('\n').filter(line => !assigns(line, name));
  let base = kept.join('\n');
  if (base.length > 0 && !base.endsWith('\n')) {
    base += base.endsWith('\r') ? '\n' : EOL;
  }
  text = `${base}${name}=${regenerated[name]}${EOL}`;
}

// Verification: dotenv's whole-file parse of the new content must show
// exactly the old view with the regenerated variables replaced. A mismatch
// means a line removal changed the text of another variable's value (a line
// removed as an assignment sat inside its multi-line quoted value), so
// refuse and leave .env untouched. Keys that only appear in the new parse
// need no separate check: such a key was swallowed by another variable's
// multi-line value before, and that value must have changed for the key to
// surface, so the equality check over the old view's keys fails first.
let verified;
try {
  verified = dotenv.parse(text);
  for (const key of Object.keys(current)) {
    const expected = key in regenerated ? regenerated[key] : current[key];
    if (verified && verified[key] !== expected) verified = null;
  }
} catch {
  verified = null;
}
if (!verified) {
  fail(`${envFile}: the rewrite would change what dotenv reads for another variable; .env left untouched`);
}

// Write through a temp file in the same directory, then rename: a failure
// (missing directory write permission, disk full) can never truncate .env.
// The rename targets the real file, so a symlinked .env stays a symlink and
// its target gets the new content.
const realFile = fs.realpathSync(envFile);
const tmp = path.join(
  path.dirname(realFile),
  `.${path.basename(realFile)}.tmp-${crypto.randomBytes(6).toString('hex')}`,
);
let mode = 0o644;
try {
  mode = fs.statSync(realFile).mode & 0o777;
} catch {
  // keep the default mode; the rename below will fail and report
}
try {
  fs.writeFileSync(tmp, text, { flag: 'wx', mode });
  fs.renameSync(tmp, realFile);
} catch (err) {
  try {
    fs.unlinkSync(tmp);
  } catch {
    // the temp file was never created
  }
  fail(`cannot rewrite ${envFile}: ${err.code || err.message}; .env left untouched`);
}

for (const name of names) {
  console.log(`✅ Generated ${name} in ${envFile}`);
}
