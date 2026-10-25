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
// agent-relay runs pre_update against the pre-pull tree, so an image build
// there builds the OLD code (wasted time, and a likely containerd snapshot
// error trigger); the deploy system builds the pulled commit itself after the
// pull. The check works on shell tokens per command segment (split at
// newlines, ;, &&, || and |), so global flags (-f, --profile), extra
// whitespace and both compose spellings are covered. A build hidden behind a
// variable or inside a called script is not visible here.
function buildsImages(entry) {
  return entry.split(/\n|;|&&|\|\||\|/).some((segment) => {
    const tok = segment.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tok.length; i++) {
      const rest = tok.slice(i + 1);
      if (tok[i] === "docker-compose" || (tok[i] === "docker" && tok[i + 1] === "compose")) {
        if (rest.includes("build") || rest.includes("--build")) return true;
      }
      if (tok[i] === "docker") {
        if (tok[i + 1] === "build") return true;
        if (tok[i + 1] === "buildx" && ["build", "bake"].includes(tok[i + 2])) return true;
        if (tok[i + 1] === "image" && tok[i + 2] === "build") return true;
      }
    }
    return false;
  });
}
// Self-check of the predicate, so a weakened matcher fails this script.
const mustFlag = [
  "docker compose build --no-cache",
  "docker-compose build",
  "docker compose -f docker-compose.yml build",
  "docker compose --profile x build",
  "docker  compose\tbuild",
  "docker compose up -d --build",
  "docker buildx bake",
  "docker buildx build .",
  "docker build .",
  "docker image build .",
  "cd x && docker compose build",
];
const mustPass = [
  "docker compose pull",
  "docker compose -f docker-compose.yml up -d",
  "echo rebuild later",
  "cp ../.secrets/triologue.env .env",
  "docker compose pull && echo build skipped",
];
for (const s of mustFlag) {
  if (!buildsImages(s)) {
    console.log(`FAIL: predicate misses a build: ${JSON.stringify(s)}`);
    bad++;
  }
}
for (const s of mustPass) {
  if (buildsImages(s)) {
    console.log(`FAIL: predicate flags a non-build: ${JSON.stringify(s)}`);
    bad++;
  }
}
if (Array.isArray(doc.pre_update)) {
  doc.pre_update.forEach((entry, i) => {
    if (typeof entry !== "string") return;
    if (buildsImages(entry)) {
      console.log(`FAIL: pre_update.${i} builds images (pre_update runs pre-pull, the build would use the old tree)`);
      bad++;
    } else {
      console.log(`PASS: pre_update.${i} builds no images`);
    }
  });
}
console.log(`checked=${total} failed=${bad}`);
process.exit(bad === 0 ? 0 : 1);
NODE
