#!/usr/bin/env bash
# Structural guard for the api container running unprivileged. The api parses
# uploaded files with poppler and tesseract, so it must not run as root with the
# default capability set. The guard checks the files, not a running container:
#   - the image server/Dockerfile builds (its last stage, or the stage a
#     compose service names with build.target) ends with a USER that is neither
#     root nor in the root group, and no instruction opens a path with chmod 777
#     (writability comes from ownership, not from a world-writable mode);
#   - the api service of docker-compose.yml and docker-compose.dev.yml carries
#     cap_drop: [ALL] and security_opt: ["no-new-privileges:true"], and does not
#     undo them: no user: override to root, no privileged: true, no cap_add.
# A real check that the process runs as uid 1000 with no capabilities needs the
# built image and stays a manual step (docs/deployment.md).
# Negative controls run the same check on mutated copies in a temp dir and must
# fail; a mutation whose anchor does not match exactly once is a hard error.
# Needs js-yaml from the root node_modules (npm ci at the repository root).
#   bash scripts/api-container-non-root.test.sh
# API_NON_ROOT_TMPDIR forces the temp dir base path (needed where `mktemp -d`
# ignores TMPDIR, e.g. macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "${API_NON_ROOT_TMPDIR:-}" ]; then
  WORKDIR="$(mktemp -d "${API_NON_ROOT_TMPDIR%/}/an.XXXXXXXX")"
else
  WORKDIR="$(mktemp -d)"
fi
trap 'rm -rf "$WORKDIR"' EXIT

fail_count=0
pass_count=0

pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# check <tree>: print one line per failed expectation, exit 1 when any. The tree
# holds server/Dockerfile, docker-compose.yml and docker-compose.dev.yml.
check() {
  (cd "$ROOT" && node - "$1" <<'NODE'
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const root = process.argv[2];
const COMPOSE_FILES = ["docker-compose.yml", "docker-compose.dev.yml"];
const ACCOUNT = /^[A-Za-z_][A-Za-z0-9_-]*$|^[0-9]+$/;
let bad = 0;
const fail = (m) => { console.log(m); bad++; };
const isRoot = (t) => t.toLowerCase() === "root" || (/^[0-9]+$/.test(t) && Number(t) === 0);
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

// A user value (Dockerfile USER or compose user:) must be a literal account
// that is neither root nor in the root group; anything else (a ${VAR}) cannot
// be judged and fails closed.
function judgeUser(where, value) {
  const tokens = String(value).trim().split(":").map((t) => t.trim());
  if (!ACCOUNT.test(tokens[0])) { fail(`FAIL: ${where}: cannot judge the account, want a literal name or uid: ${value}`); return; }
  if (isRoot(tokens[0])) { fail(`FAIL: ${where}: runs as root: ${value}`); return; }
  if (tokens.length > 1 && (!ACCOUNT.test(tokens[1]) || isRoot(tokens[1]))) {
    fail(`FAIL: ${where}: runs in the root group or a group that cannot be judged: ${value}`);
  }
}

// Instructions with trailing backslashes joined; whole-line comments dropped.
function instructions(text) {
  const out = []; let pending = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("\\")) { pending += line.slice(0, -1).trim() + " "; continue; }
    out.push((pending + line).trim()); pending = "";
  }
  if (pending) out.push(pending.trim());
  return out;
}

function stages(text) {
  const found = [];
  for (const line of instructions(text)) {
    const parts = line.split(/\s+/);
    if (parts[0].toLowerCase() === "from") {
      const rest = parts.slice(1).filter((p) => !p.startsWith("--"));
      const name = rest.length >= 3 && rest[1].toLowerCase() === "as" ? rest[2] : null;
      found.push({ name, lines: [] });
    } else if (found.length) {
      found[found.length - 1].lines.push(line);
    }
  }
  return found;
}

const docs = {};
for (const f of COMPOSE_FILES) {
  try { docs[f] = yaml.load(fs.readFileSync(path.join(root, f), "utf8")) || {}; }
  catch (e) { fail(`FAIL: ${f} cannot be read: ${e.message}`); }
}

// The image that runs is the stage a compose build.target names, else the last.
const targets = new Set();
for (const doc of Object.values(docs)) {
  const build = ((doc.services || {}).api || {}).build;
  if (build && typeof build === "object" && build.target) targets.add(String(build.target));
}

const dockerfile = "server/Dockerfile";
let text = "";
try { text = fs.readFileSync(path.join(root, dockerfile), "utf8"); }
catch (e) { fail(`FAIL: ${dockerfile} cannot be read: ${e.message}`); }
const found = stages(text);
if (!found.length) fail(`FAIL: ${dockerfile} has no stage, so there is no image to check`);
const runStages = found.length
  ? (targets.size ? [...targets].map((t) => found.filter((s) => s.name === t).pop()) : [found[found.length - 1]])
  : [];
for (const stage of runStages) {
  if (!stage) { fail(`FAIL: ${dockerfile}: a compose build.target names a stage the file does not have`); continue; }
  const label = `${dockerfile} (${stage.name ? "stage " + stage.name : "last stage"})`;
  const users = stage.lines.filter((l) => l.split(/\s+/)[0].toLowerCase() === "user");
  if (!users.length) fail(`FAIL: ${label}: no USER directive, the api runs as root`);
  else judgeUser(`${label}: last USER`, users[users.length - 1].split(/\s+/).slice(1).join(" "));
}
for (const line of found.flatMap((s) => s.lines)) {
  if (/\bchmod\b[^&;|]*\b0?777\b/.test(line)) fail(`FAIL: ${dockerfile}: chmod 777 opens a path to every user, use ownership instead: ${line}`);
}

for (const [file, doc] of Object.entries(docs)) {
  const cfg = (doc.services || {}).api;
  if (!cfg || typeof cfg !== "object") { fail(`FAIL: ${file} has no api service`); continue; }
  if (!asList(cfg.cap_drop).some((v) => v.trim().toUpperCase() === "ALL")) fail(`FAIL: ${file}: api must cap_drop ALL: cap_drop ${JSON.stringify(cfg.cap_drop)}`);
  if (!asList(cfg.security_opt).some((v) => v.trim().toLowerCase() === "no-new-privileges:true")) fail(`FAIL: ${file}: api must set security_opt no-new-privileges:true: security_opt ${JSON.stringify(cfg.security_opt)}`);
  if (cfg.user != null && String(cfg.user).trim() !== "") judgeUser(`${file}: api user override`, cfg.user);
  const priv = cfg.privileged;
  if (priv === true || ["true", "yes", "on", "1"].includes(String(priv).trim().toLowerCase())) fail(`FAIL: ${file}: api must not run privileged`);
  if (asList(cfg.cap_add).some((v) => v.trim())) fail(`FAIL: ${file}: api must not cap_add, it defeats cap_drop ALL: cap_add ${JSON.stringify(cfg.cap_add)}`);
}
if (bad === 0) console.log("ok: no findings");
process.exit(bad ? 1 : 0);
NODE
  )
}

# ── The shipped files ────────────────────────────────────────────────────────

if out="$(check "$ROOT" 2>&1)"; then
  pass "server/Dockerfile and both compose api services are unprivileged"
else
  fail "shipped files: $out"
fi

# ── Negative controls: each mutation must make the check fail ────────────────

mut_tree() { # mut_tree <name>: copy the three files into $WORKDIR/<name>
  mkdir -p "$WORKDIR/$1/server"
  cp "$ROOT/server/Dockerfile" "$WORKDIR/$1/server/Dockerfile"
  cp "$ROOT/docker-compose.yml" "$ROOT/docker-compose.dev.yml" "$WORKDIR/$1/"
}

# control <name> <file in tree> <sed expression> <anchor regex> <expected text>
control() {
  local name="$1" file="$2" expr="$3" anchor="$4" want="$5" tree out n
  tree="$WORKDIR/$name"
  mut_tree "$name"
  n="$(grep -cE "$anchor" "$tree/$file" || true)"
  if [ "$n" -lt 1 ]; then
    echo "ERROR: control $name: anchor '$anchor' not found in $file" >&2
    exit 2
  fi
  sed -E "$expr" "$tree/$file" > "$tree/$file.new" && mv "$tree/$file.new" "$tree/$file"
  if cmp -s "$tree/$file" "$ROOT/$file"; then
    echo "ERROR: control $name: the mutation changed nothing" >&2
    exit 2
  fi
  if out="$(check "$tree" 2>&1)"; then
    fail "control: $name passed the check"
  elif printf '%s\n' "$out" | grep -qF "$want"; then
    pass "control: $name fails with '$want'"
  else
    fail "control: $name failed, but not with '$want': $out"
  fi
}

control no-user server/Dockerfile '/^USER node$/d' '^USER node$' 'no USER directive'
control user-root server/Dockerfile 's/^USER node$/USER root/' '^USER node$' 'runs as root'
control user-root-group server/Dockerfile 's/^USER node$/USER 1000:0/' '^USER node$' 'root group'
control chmod-777 server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod 777 /app/data|' '^RUN mkdir -p ' 'chmod 777'
control no-cap-drop docker-compose.yml '/^    cap_drop: \[ALL\]$/d' '^    cap_drop: \[ALL\]$' 'must cap_drop ALL'
control no-new-privs docker-compose.yml '/^    security_opt: \["no-new-privileges:true"\]$/d' '^    security_opt: ' 'no-new-privileges:true'
control cap-add docker-compose.yml 's/^    cap_drop: \[ALL\]$/&\n    cap_add: [NET_ADMIN]/' '^    cap_drop: \[ALL\]$' 'must not cap_add'
control compose-user-root docker-compose.yml 's/^    cap_drop: \[ALL\]$/&\n    user: root/' '^    cap_drop: \[ALL\]$' 'api user override'
control privileged docker-compose.yml 's/^    cap_drop: \[ALL\]$/&\n    privileged: true/' '^    cap_drop: \[ALL\]$' 'must not run privileged'
control dev-no-cap-drop docker-compose.dev.yml '/^    cap_drop: \[ALL\]$/d' '^    cap_drop: \[ALL\]$' 'docker-compose.dev.yml: api must cap_drop ALL'

echo ""
echo "api-container-non-root.test.sh: $pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ]
