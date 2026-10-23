// Preloaded with `node -r` into a child process that runs prisma/seed.ts, so
// the seed runs against an in-memory stand-in for @prisma/client and no
// database is needed. FAKE_ADMIN_EXISTS=1 makes user.findUnique return a user
// (the admin exists), anything else returns null. Every write call is printed
// as `FAKE_WRITE <model>.<method>` so a test can assert what was (not) written.
const Module = require('module');

const WRITES = new Set(['upsert', 'create', 'update', 'delete', 'updateMany', 'createMany', 'deleteMany']);
const adminExists = process.env.FAKE_ADMIN_EXISTS === '1';

function model(name) {
  return new Proxy({}, {
    get: (_target, method) => {
      if (method === 'then') return undefined;
      return async () => {
        if (WRITES.has(String(method))) console.log(`FAKE_WRITE ${name}.${String(method)}`);
        if (name === 'user' && method === 'findUnique') return adminExists ? { id: 'admin-id' } : null;
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
