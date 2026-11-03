// Preloaded with `node -r` into a child process that runs prisma/seed.ts, so
// the seed runs against an in-memory stand-in for @prisma/client and no
// database is needed. FAKE_EXISTING_USERNAMES (comma separated) lists the users
// that already exist: user.findUnique returns a user for those usernames and
// null for any other (the found user carries the userType configured in
// FAKE_USER_TYPES, comma separated `username=TYPE` pairs; AI_AGENT when a user is
// not listed), and user.upsert takes its update path for them and its
// create path for any other. FAKE_EXISTING_RECORDS (comma separated model names)
// makes findUnique and findFirst on those other models return a record, so the
// update path of a find-then-write is reachable too.
//
// Client-level `$` methods are recorded too: every `$` property of the client other than
// the `$connect`/`$disconnect` lifecycle calls prints `FAKE_CLIENT_CALL <method>` (so
// $executeRaw, $executeRawUnsafe, $queryRaw, $queryRawUnsafe, $transaction and any `$`
// method added later). A `$transaction` callback is run against the client, so the model
// writes inside it are recorded as usual; the call itself resolves to undefined.
//
// Output, one line per event, so a test can assert what was (not) written:
//   FAKE_WRITE <model>.<method>        every write call (any model method not on the READS
//                                      list counts as a write, so a write method added
//                                      later, such as createManyAndReturn, is covered)
//   FAKE_FIELDS model=<model> method=<method> path=<data|create|update> keys=<a,b,c>
//                                      one line per write argument object holding rows
//                                      (data, create, update), listing its sorted top-level
//                                      key names; values are never printed, so a secret
//                                      (token, passwordHash) cannot leak through this line
//   FAKE_FIELD model=<model> method=<method> path=<data|create|update> key=<k> value=<v>
//                                      the same fields again, one line each, but only for
//                                      the non-secret VALUE_KEYS (roles, flags, statuses)
//   FAKE_CLIENT_CALL <method>          every client-level `$` call except $connect/$disconnect
//   FAKE_CREATED_USER=<username>       every user the seed creates (a username is not secret)
//   FAKE_PASSWORD_WRITE model=<model> method=<method> path=<dotted path> matches=<true|false|invalid>
//                                      every write call whose arguments contain a
//                                      `passwordHash` key at any depth, whatever the
//                                      method; `matches` says whether that hash is a bcrypt
//                                      hash of ADMIN_PASSWORD (`invalid` for a non-string)
// Neither the password nor a hash is ever printed.
//
// Limit: a raw-SQL call is recorded (FAKE_CLIENT_CALL) but its SQL text is not
// inspected, so a test asserts that no such call happens at all rather than what
// it writes.
const Module = require('module');
const bcrypt = require('bcryptjs');

// Read methods; every other model method is treated as a write.
const READS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
]);
// Write-argument keys whose values are safe to print (flags, roles, statuses):
// they never hold a secret, and they are what a create-only check pins.
const VALUE_KEYS = new Set([
  'isAdmin', 'isActive', 'canTriggerAI', 'userType', 'status', 'trustLevel', 'role',
]);
const csv = value => (value || '').split(',').map(name => name.trim()).filter(Boolean);
const existingUsernames = new Set(csv(process.env.FAKE_EXISTING_USERNAMES));
const existingRecords = new Set(csv(process.env.FAKE_EXISTING_RECORDS));
const userTypes = new Map(csv(process.env.FAKE_USER_TYPES).map(pair => pair.split('=').map(part => part.trim())));

// Dotted path of every `passwordHash` key anywhere in a call's arguments. A deep
// scan, so a write method or an argument shape added later is covered as well.
function passwordHashPaths(value, prefix = '', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const found = [];
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === 'passwordHash') found.push({ path, hash: value[key] });
    found.push(...passwordHashPaths(value[key], path, seen));
  }
  return found;
}

function hashMatches(hash) {
  if (typeof hash !== 'string') return 'invalid';
  return String(bcrypt.compareSync(process.env.ADMIN_PASSWORD ?? '', hash));
}

// Usernames this call creates: create, createMany, createManyAndReturn, and the create side of an
// upsert whose user does not exist yet.
function createdUsernames(method, args) {
  if (!args) return [];
  if (method === 'create') return args.data ? [args.data.username] : [];
  if (method === 'createMany' || method === 'createManyAndReturn') return [].concat(args.data || []).map(row => row.username);
  if (method === 'upsert') {
    const username = args.where && args.where.username;
    return existingUsernames.has(username) || !args.create ? [] : [args.create.username];
  }
  return [];
}

// The write-argument objects that hold the fields being written: `data` for a
// create/update, `create` and `update` for an upsert. Printed as sorted key
// names (plus values for VALUE_KEYS), never as full objects.
function writtenFieldPaths(args) {
  if (!args || typeof args !== 'object') return [];
  const found = [];
  for (const path of ['data', 'create', 'update']) {
    if (args[path] && typeof args[path] === 'object') found.push({ path, row: args[path] });
  }
  return found;
}

function model(name) {
  return new Proxy({}, {
    get: (_target, method) => {
      if (method === 'then') return undefined;
      return async (args) => {
        if (!READS.has(String(method))) {
          console.log(`FAKE_WRITE ${name}.${String(method)}`);
          for (const { path, row } of writtenFieldPaths(args)) {
            const keys = Object.keys(row).sort();
            console.log(`FAKE_FIELDS model=${name} method=${String(method)} path=${path} keys=${keys.join(',')}`);
            for (const key of keys) {
              if (VALUE_KEYS.has(key)) console.log(`FAKE_FIELD model=${name} method=${String(method)} path=${path} key=${key} value=${String(row[key])}`);
            }
          }
          for (const { path, hash } of passwordHashPaths(args)) {
            console.log(`FAKE_PASSWORD_WRITE model=${name} method=${String(method)} path=${path} matches=${hashMatches(hash)}`);
          }
          if (name === 'user') {
            for (const username of createdUsernames(String(method), args)) console.log(`FAKE_CREATED_USER=${username}`);
          }
        }
        if (name === 'user' && method === 'findUnique') {
          const username = args && args.where && args.where.username;
          return existingUsernames.has(username) ? { id: 'admin-id', userType: userTypes.get(username) || 'AI_AGENT' } : null;
        }
        if (method === 'findUnique' || method === 'findFirst') return existingRecords.has(name) ? { id: `${name}-id` } : null;
        return { id: `${name}-id` };
      };
    },
  });
}

class PrismaClient {
  constructor() {
    const client = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined;
        if (prop === '$disconnect' || prop === '$connect') return async () => undefined;
        if (typeof prop === 'string' && prop.startsWith('$')) {
          return async (arg) => {
            console.log(`FAKE_CLIENT_CALL ${prop}`);
            if (prop === '$transaction' && typeof arg === 'function') return arg(client);
            return undefined;
          };
        }
        return model(String(prop));
      },
    });
    return client;
  }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === '@prisma/client') return { PrismaClient };
  return originalLoad.call(this, request, ...rest);
};
