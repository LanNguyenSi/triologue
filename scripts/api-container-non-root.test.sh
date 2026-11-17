#!/usr/bin/env bash
# Structural guard for the api container running unprivileged. The api parses
# uploaded files with poppler and tesseract, so it must not run as root with the
# default capability set. The guard checks the files, not a running container:
#   - the image server/Dockerfile builds (its last stage, or the stage a
#     compose service names with build.target) ends with a USER that is neither
#     root nor in the root group, and no chmod makes a path world-writable
#     (octal ending in 2, 3, 6 or 7, or symbolic o+w, a+w, +w, a+rwx):
#     writability comes from ownership, not from the mode;
#   - the api service of docker-compose.yml and docker-compose.dev.yml carries
#     cap_drop: [ALL] and security_opt: ["no-new-privileges:true"], and does not
#     undo them: no user: override to root, no privileged: true, no cap_add;
#   - the dev api mounts /app/uploads from a declared named volume, not a host
#     path (a host directory is not writable by uid 1000 on every VM mount).
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
// A mode that lets every user write: an octal whose last digit has the write
// bit (2, 3, 6, 7), or a symbolic clause that adds w for others, all or nobody
// named (+w is filtered by the umask but still a world-writable intent).
function worldWritable(mode) {
  if (/^[0-7]{3,4}$/.test(mode)) return "2367".includes(mode[mode.length - 1]);
  return mode.split(",").some((clause) => {
    const m = /^([ugoa]*)([+=])([rwxXst]*)$/.exec(clause);
    return m !== null && m[3].includes("w") && (m[1] === "" || /[oa]/.test(m[1]));
  });
}
for (const line of found.flatMap((s) => s.lines)) {
  for (const seg of line.split(/&&|;|\|\|/)) {
    const words = seg.trim().split(/\s+/);
    const at = words.indexOf("chmod");
    if (at < 0) continue;
    const args = words.slice(at + 1).filter((w) => !w.startsWith("-") || /^-[ugoa]*[+=]/.test(w));
    if (args.length && worldWritable(args[0])) fail(`FAIL: ${dockerfile}: chmod ${args[0]} makes a path world-writable, use ownership instead: ${seg.trim()}`);
  }
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
// The dev api keeps /app/uploads in a named volume: a host bind mount's
// ownership depends on the host uid and the VM mount (colima, Docker Desktop),
// and the uid-1000 entrypoint check then exits on an unwritable directory.
// Production keeps its documented bind mount and chown step.
const devApi = ((docs["docker-compose.dev.yml"] || {}).services || {}).api || {};
const uploadMounts = (Array.isArray(devApi.volumes) ? devApi.volumes : []).map((v) => {
  if (v && typeof v === "object") return { target: String(v.target || ""), source: String(v.source || ""), type: String(v.type || "") };
  const [source, target] = String(v).split(":");
  return { target: target || "", source, type: /^[./~$]/.test(source) ? "bind" : "volume" };
}).filter((m) => m.target === "/app/uploads");
if (uploadMounts.length !== 1) fail(`FAIL: docker-compose.dev.yml: api must mount /app/uploads exactly once, found ${uploadMounts.length}`);
else if (uploadMounts[0].type === "bind" || /^[./~$]/.test(uploadMounts[0].source)) fail(`FAIL: docker-compose.dev.yml: api /app/uploads must be a named volume, not the host path ${uploadMounts[0].source}`);
else if (!Object.prototype.hasOwnProperty.call(docs["docker-compose.dev.yml"].volumes || {}, uploadMounts[0].source)) fail(`FAIL: docker-compose.dev.yml: api /app/uploads volume ${uploadMounts[0].source} is not declared under volumes`);
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
  if [ "$n" -ne 1 ]; then
    echo "ERROR: control $name: anchor '$anchor' matches $n lines in $file, want exactly 1" >&2
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
control chmod-777 server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod 777 /app/data|' '^RUN mkdir -p ' 'chmod 777 makes'
control chmod-1777 server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod 1777 /app/data|' '^RUN mkdir -p ' 'chmod 1777 makes'
control chmod-666 server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod 666 /app/data|' '^RUN mkdir -p ' 'chmod 666 makes'
control chmod-plus-w server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod +w /app/data|' '^RUN mkdir -p ' 'chmod +w makes'
control chmod-o-plus-w server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod o+w /app/data|' '^RUN mkdir -p ' 'chmod o+w makes'
control chmod-second-in-chain server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod 755 /app/x \&\& chmod 777 /app/data|' '^RUN mkdir -p ' 'chmod 777 makes'
control chmod-a-rwx server/Dockerfile 's|^(RUN mkdir -p .*)$|\1 \&\& chmod a+rwx /app/data|' '^RUN mkdir -p ' 'chmod a+rwx makes'
control user-appended-root server/Dockerfile 's/^USER node$/&\nUSER root/' '^USER node$' 'last USER: runs as root'
# shellcheck disable=SC2016
control stage-without-user server/Dockerfile '$a\
FROM node:22-slim AS final' '^USER node$' 'stage final): no USER'
# shellcheck disable=SC2016
control user-variable server/Dockerfile 's/^USER node$/USER ${APP_USER}/' '^USER node$' 'cannot judge the account'
control cap-drop-other docker-compose.yml 's/^    cap_drop: \[ALL\]$/    cap_drop: [NET_RAW]/' '^    cap_drop: \[ALL\]$' 'must cap_drop ALL'
control api-renamed docker-compose.yml 's/^  api:$/  backend:/' '^  api:$' 'has no api service'
control no-cap-drop docker-compose.yml '/^    cap_drop: \[ALL\]$/d' '^    cap_drop: \[ALL\]$' 'must cap_drop ALL'
control no-new-privs docker-compose.yml '/^    security_opt: \["no-new-privileges:true"\]$/d' '^    security_opt: ' 'no-new-privileges:true'
control cap-add docker-compose.yml 's/^    cap_drop: \[ALL\]$/&\n    cap_add: [NET_ADMIN]/' '^    cap_drop: \[ALL\]$' 'must not cap_add'
control compose-user-root docker-compose.yml 's/^    cap_drop: \[ALL\]$/&\n    user: root/' '^    cap_drop: \[ALL\]$' 'api user override'
control privileged docker-compose.yml 's/^    cap_drop: \[ALL\]$/&\n    privileged: true/' '^    cap_drop: \[ALL\]$' 'must not run privileged'
control dev-no-cap-drop docker-compose.dev.yml '/^    cap_drop: \[ALL\]$/d' '^    cap_drop: \[ALL\]$' 'docker-compose.dev.yml: api must cap_drop ALL'
control dev-uploads-bind docker-compose.dev.yml 's|^      - uploads_data:/app/uploads$|      - ./server/uploads:/app/uploads|' '^      - uploads_data:/app/uploads$' 'must be a named volume'
control dev-uploads-undeclared docker-compose.dev.yml '/^  uploads_data:$/,+1d' '^  uploads_data:$' 'is not declared under volumes'
control dev-uploads-unmounted docker-compose.dev.yml '/^      - uploads_data:\/app\/uploads$/d' '^      - uploads_data:/app/uploads$' 'must mount /app/uploads exactly once'

# A compose build.target names the stage that runs: a target stage without USER
# must fail even when the last stage of the file has one.
mut_tree target-stage
printf '\nFROM node:22-slim AS other\nFROM other AS last\nUSER node\n' >> "$WORKDIR/target-stage/server/Dockerfile"
sed -E 's|^(      context: ./server)$|\1\n      target: other|' "$ROOT/docker-compose.yml" > "$WORKDIR/target-stage/docker-compose.yml"
if ! grep -q '^      target: other$' "$WORKDIR/target-stage/docker-compose.yml"; then
  echo "ERROR: control target-stage: the mutation changed nothing" >&2
  exit 2
fi
if out="$(check "$WORKDIR/target-stage" 2>&1)"; then
  fail "control: target-stage passed the check"
elif printf '%s\n' "$out" | grep -qF 'stage other): no USER'; then
  pass "control: target-stage fails with 'stage other): no USER'"
else
  fail "control: target-stage failed, but not with 'stage other): no USER': $out"
fi

echo ""
echo "api-container-non-root.test.sh: $pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ]
