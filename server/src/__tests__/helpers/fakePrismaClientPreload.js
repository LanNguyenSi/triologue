// Preloaded with `node -r` into a child process that runs prisma/seed.ts, so
// the seed runs against an in-memory stand-in for @prisma/client and no
// database is needed. FAKE_EXISTING_USERNAMES (comma separated) lists the users
// that already exist: user.findUnique returns a user for those usernames and
// null for any other, and user.upsert takes its update path for them and its
// create path for any other. FAKE_EXISTING_RECORDS (comma separated model names)
// makes findUnique and findFirst on those other models return a record, so the
// update path of a find-then-write is reachable too.
//
// Output, one line per event, so a test can assert what was (not) written:
//   FAKE_WRITE <model>.<method>        every write call (any model method not on the READS
//                                      list counts as a write, so a write method added
//                                      later, such as createManyAndReturn, is covered)
//   FAKE_CREATED_USER=<username>       every user the seed creates (a username is not secret)
//   FAKE_PASSWORD_WRITE model=<model> method=<method> path=<dotted path> matches=<true|false|invalid>
//                                      every write call whose arguments contain a
//                                      `passwordHash` key at any depth, whatever the
//                                      method; `matches` says whether that hash is a bcrypt
//                                      hash of ADMIN_PASSWORD (`invalid` for a non-string)
// Neither the password nor a hash is ever printed.
const Module = require('module');
const bcrypt = require('bcryptjs');

// Read methods; every other model method is treated as a write.
const READS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
]);
const csv = value => (value || '').split(',').map(name => name.trim()).filter(Boolean);
const existingUsernames = new Set(csv(process.env.FAKE_EXISTING_USERNAMES));
const existingRecords = new Set(csv(process.env.FAKE_EXISTING_RECORDS));

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

function model(name) {
  return new Proxy({}, {
    get: (_target, method) => {
      if (method === 'then') return undefined;
      return async (args) => {
        if (!READS.has(String(method))) {
          console.log(`FAKE_WRITE ${name}.${String(method)}`);
          for (const { path, hash } of passwordHashPaths(args)) {
            console.log(`FAKE_PASSWORD_WRITE model=${name} method=${String(method)} path=${path} matches=${hashMatches(hash)}`);
          }
          if (name === 'user') {
            for (const username of createdUsernames(String(method), args)) console.log(`FAKE_CREATED_USER=${username}`);
          }
        }
        if (name === 'user' && method === 'findUnique') {
          const username = args && args.where && args.where.username;
          return existingUsernames.has(username) ? { id: 'admin-id' } : null;
        }
        if (method === 'findUnique' || method === 'findFirst') return existingRecords.has(name) ? { id: `${name}-id` } : null;
        return { id: `${name}-id` };
      };
    },
  });
}

class PrismaClient {
  constructor() {
    return new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined;
        if (prop === '$disconnect') return async () => undefined;
        return model(String(prop));
      },
    });
  }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (request === '@prisma/client') return { PrismaClient };
  return originalLoad.call(this, request, ...rest);
};
