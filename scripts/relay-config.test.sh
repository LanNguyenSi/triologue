#!/usr/bin/env bash
# Guards the shape of .relay.yml the way agent-relay's loader reads it: every
# pre_update and post_update entry must be a YAML string. A plain scalar with a
# ": " inside (for example in an echo text) parses as a mapping, agent-relay
# rejects the file ("post_update.0: Expected string, received object"), and
# every deploy then fails and rolls back before any step runs.
# Needs js-yaml from the root node_modules (npm ci at the repository root).
#   bash scripts/relay-config.test.sh [path to .relay.yml]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-$ROOT/.relay.yml}"

cd "$ROOT"
node - "$CONFIG" <<'NODE'
const fs = require("fs");
const yaml = require("js-yaml");
const file = process.argv[2];
const doc = yaml.load(fs.readFileSync(file, "utf8"));
let bad = 0;
let total = 0;
for (const key of ["pre_update", "post_update"]) {
  const list = doc[key];
  if (list === undefined) continue;
  if (!Array.isArray(list)) {
    console.log(`FAIL: ${key} is not a list`);
    bad++;
    continue;
  }
  list.forEach((entry, i) => {
    total++;
    if (typeof entry === "string") {
      console.log(`PASS: ${key}.${i} is a string`);
    } else {
      console.log(`FAIL: ${key}.${i} is ${JSON.stringify(entry)}, not a string`);
      bad++;
    }
  });
}
if (total === 0) {
  console.log("FAIL: no pre_update or post_update entries found");
  bad++;
}
console.log(`checked=${total} failed=${bad}`);
process.exit(bad === 0 ? 0 : 1);
NODE
