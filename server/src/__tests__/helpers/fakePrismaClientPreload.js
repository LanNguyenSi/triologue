// Preloaded with `node -r` into a child process that runs prisma/seed.ts, so
// the seed runs against an in-memory stand-in for @prisma/client and no
// database is needed. FAKE_EXISTING_USERNAMES (comma separated) lists the users
// that already exist: user.findUnique returns a user for those usernames and
// null for any other. Every write call is printed as `FAKE_WRITE <model>.<method>`
// so a test can assert what was (not) written. When user.upsert creates a user
// with a passwordHash, `FAKE_ADMIN_HASH_MATCHES=<true|false>` says whether that
// hash is a bcrypt hash of ADMIN_PASSWORD; neither the password nor the hash is
// printed.
const Module = require('module');
const bcrypt = require('bcryptjs');

const WRITES = new Set(['upsert', 'create', 'update', 'delete', 'updateMany', 'createMany', 'deleteMany']);
const existingUsernames = new Set(
  (process.env.FAKE_EXISTING_USERNAMES || '').split(',').map(name => name.trim()).filter(Boolean),
);

function model(name) {
  return new Proxy({}, {
    get: (_target, method) => {
      if (method === 'then') return undefined;
      return async (args) => {
        if (WRITES.has(String(method))) console.log(`FAKE_WRITE ${name}.${String(method)}`);
        if (name === 'user' && method === 'upsert' && args && args.create && args.create.passwordHash) {
          const matches = bcrypt.compareSync(String(process.env.ADMIN_PASSWORD), args.create.passwordHash);
          console.log(`FAKE_ADMIN_HASH_MATCHES=${matches}`);
        }
        if (name === 'user' && method === 'findUnique') {
          const username = args && args.where && args.where.username;
          return existingUsernames.has(username) ? { id: 'admin-id' } : null;
        }
        if (method === 'findUnique' || method === 'findFirst') return null;
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
