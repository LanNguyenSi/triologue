#!/usr/bin/env bash
# Guards the host port bindings of the production docker-compose.yml: the api
# service must publish its port on the loopback interface only, so the API is
# not reachable over plain HTTP from outside the host (past Traefik and TLS),
# and no service may publish a port without a host IP. Host-local consumers
# (agent gateway, reverse proxies) reach it on localhost:4001.
# Needs js-yaml from the root node_modules (npm ci at the repository root).
#   bash scripts/compose-ports.test.sh [path to docker-compose.yml]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-$ROOT/docker-compose.yml}"

cd "$ROOT"
node - "$CONFIG" <<'NODE'
const fs = require("fs");
const yaml = require("js-yaml");
const doc = yaml.load(fs.readFileSync(process.argv[2], "utf8"));
const services = doc.services || {};
let bad = 0;

const apiPorts = (services.api && services.api.ports) || [];
if (apiPorts.length === 1 && apiPorts[0] === "127.0.0.1:4001:3001") {
  console.log("PASS: api publishes exactly 127.0.0.1:4001:3001");
} else {
  console.log(`FAIL: api ports are ${JSON.stringify(apiPorts)}, expected ["127.0.0.1:4001:3001"]`);
  bad++;
}

for (const [name, svc] of Object.entries(services)) {
  for (const p of svc.ports || []) {
    const s = String(p);
    if (/^127\.0\.0\.1:/.test(s)) continue;
    console.log(`FAIL: ${name} publishes ${s} without a loopback host IP`);
    bad++;
  }
}
if (bad > 0) {
  console.log(`checked failed=${bad}`);
  process.exit(1);
}
console.log("checked failed=0");
NODE
