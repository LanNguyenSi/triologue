/**
 * prisma/seed.ts and the sample agents (create-only).
 *
 * Same harness as seed-admin-password.test.ts: the seed runs as a child
 * process with @prisma/client replaced by the in-memory stand-in in
 * helpers/fakePrismaClientPreload.js, so no database is needed and every
 * write is visible in the output.
 *
 * The rule under test: the seed creates a sample agent (user, token, default
 * room memberships) only when its user does not exist yet. An existing agent
 * user is never written back to: no update of isActive, canTriggerAI,
 * userType or displayName, no update of the token (webhookUrl, trustLevel,
 * status and isActive are all admin-settable), and a room membership removed
 * from an existing agent is not re-added. The one exception: an existing user
 * whose token row is missing gets a token (there is nothing to preserve),
 * without re-adding room memberships. The admin user's behaviour (created
 * when missing, flagged isAdmin on every start, joined to the default rooms)
 * is unchanged.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const SERVER_DIR = path.resolve(__dirname, '../..');
const TS_NODE_BIN = require.resolve('ts-node/dist/bin.js');
const PRELOAD = path.join(__dirname, 'helpers', 'fakePrismaClientPreload.js');
const STRONG = 'a-strong-admin-pass-1';

let scratch: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-'));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

interface SeedScenario {
  /** Usernames that already exist in the fake database. */
  existing: string[];
  /** Models (other than user) whose lookups find an existing record. */
  records?: string[];
}

function runSeed(scenario: SeedScenario) {
  const { existing, records = [] } = scenario;
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: scratch,
    TMPDIR: scratch,
    TS_NODE_TRANSPILE_ONLY: '1',
    ADMIN_PASSWORD: STRONG,
    FAKE_EXISTING_USERNAMES: existing.join(','),
    FAKE_EXISTING_RECORDS: records.join(','),
  };
  const cwd = fs.mkdtempSync(path.join(scratch, 'cwd-'));
  const seedScript = path.join(SERVER_DIR, 'prisma', 'seed.ts');
  const result = spawnSync(process.execPath, ['-r', PRELOAD, TS_NODE_BIN, seedScript], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 90_000,
    killSignal: 'SIGKILL',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, error: result.error };
}

const linesWith = (output: string, prefix: string) =>
  output.split('\n').filter(line => line.startsWith(prefix));
const writes = (output: string) => linesWith(output, 'FAKE_WRITE').sort();
const fields = (output: string) => linesWith(output, 'FAKE_FIELDS').sort();
const values = (output: string) => linesWith(output, 'FAKE_FIELD ');
const createdUsers = (output: string) => linesWith(output, 'FAKE_CREATED_USER=');
const countOf = (lines: string[], line: string) => lines.filter(l => l === line).length;
const agentLines = (output: string) =>
  output.split('\n').filter(line => line.includes('agent: Ice') || line.includes('agent: Lava'));
const agentJoinedLines = (output: string) => output.split('\n').filter(line => line.startsWith('    joined:'));

// The exact write set of the seed's non-agent part: the onboarding room, the
// admin flag on the existing admin and the admin's own room join. An existing
// sample agent may add nothing to this list.
const ADMIN_ONLY_WRITES = [
  'FAKE_WRITE room.upsert',
  'FAKE_WRITE roomParticipant.upsert',
  'FAKE_WRITE user.update',
].sort();
// Today's token fields, as recorded on a create.
const TOKEN_CREATE_KEYS =
  'FAKE_FIELDS model=agentToken method=create path=data keys=color,createdById,description,emoji,isActive,mentionKey,name,status,token,trustLevel,userId,webhookUrl';

describe('seed, fresh database: both sample agents are created with today\u0027s fields', () => {
  it('creates the users, the tokens and the room memberships', () => {
    const { status, output, error } = runSeed({ existing: [] });
    expect(error).toBeUndefined();
    expect(status).toBe(0);
    expect(output).toContain('Seed complete');
    expect(createdUsers(output)).toEqual(['FAKE_CREATED_USER=lan', 'FAKE_CREATED_USER=ice', 'FAKE_CREATED_USER=lava']);

    // Users: exactly the admin create plus the two agent creates.
    expect(writes(output)).toEqual([
      'FAKE_WRITE agentToken.create',
      'FAKE_WRITE agentToken.create',
      'FAKE_WRITE room.upsert',
      'FAKE_WRITE roomParticipant.upsert',
      'FAKE_WRITE roomParticipant.upsert',
      'FAKE_WRITE roomParticipant.upsert',
      'FAKE_WRITE user.create',
      'FAKE_WRITE user.create',
      'FAKE_WRITE user.upsert',
    ]);

    // Agent users carry the same fields as before the create-only change.
    const agentUserCreate = 'FAKE_FIELDS model=user method=create path=data keys=canTriggerAI,displayName,isActive,userType,username';
    expect(countOf(fields(output), agentUserCreate)).toBe(2);
    expect(values(output)).toContain('FAKE_FIELD model=user method=create path=data key=userType value=AI_AGENT');
    expect(values(output)).toContain('FAKE_FIELD model=user method=create path=data key=isActive value=true');
    expect(values(output)).toContain('FAKE_FIELD model=user method=create path=data key=canTriggerAI value=true');

    // Tokens: active, elevated, created by the admin, twice.
    expect(countOf(fields(output), TOKEN_CREATE_KEYS)).toBe(2);
    expect(countOf(values(output), 'FAKE_FIELD model=agentToken method=create path=data key=status value=active')).toBe(2);
    expect(countOf(values(output), 'FAKE_FIELD model=agentToken method=create path=data key=isActive value=true')).toBe(2);
    expect(countOf(values(output), 'FAKE_FIELD model=agentToken method=create path=data key=trustLevel value=elevated')).toBe(2);

    // Memberships: the admin joins as ADMIN, both agents as MEMBER.
    expect(countOf(fields(output), 'FAKE_FIELDS model=roomParticipant method=upsert path=create keys=role,roomId,userId')).toBe(3);
    expect(countOf(values(output), 'FAKE_FIELD model=roomParticipant method=upsert path=create key=role value=ADMIN')).toBe(1);
    expect(countOf(values(output), 'FAKE_FIELD model=roomParticipant method=upsert path=create key=role value=MEMBER')).toBe(2);

    expect(agentLines(output)).toEqual([
      '  agent: Ice \u{1F9CA} (created, token generated)',
      '  agent: Lava \u{1F30B} (created, token generated)',
    ]);
    expect(agentJoinedLines(output)).toHaveLength(2);
  }, 120_000);
});

describe('seed, existing sample agents (an admin deactivated lava and lowered its trust)', () => {
  it('changes nothing an admin can manage: no user update, no token write, no room re-join', () => {
    const { status, output, error } = runSeed({ existing: ['lan', 'ice', 'lava'], records: ['agentToken'] });
    expect(error).toBeUndefined();
    expect(status).toBe(0);
    expect(output).toContain('Seed complete');

    // The whole run writes exactly the admin-flag update and the admin-side
    // rows: nothing exists for ice/lava (no user.create for them either).
    expect(writes(output)).toEqual(ADMIN_ONLY_WRITES);
    expect(createdUsers(output)).toEqual([]);

    // The only user/token field write of the run is the admin flag. Restoring
    // `isActive: true` in the agent user update, the token update block or
    // the unconditional agent room upserts each add lines here and fail.
    const userTokenWrites = output
      .split('\n')
      .filter(line => line.startsWith('FAKE_FIELDS model=user') || line.startsWith('FAKE_FIELDS model=agentToken'));
    expect(userTokenWrites).toEqual(['FAKE_FIELDS model=user method=update path=data keys=isAdmin']);
    const userTokenValues = values(output).filter(line => line.includes('model=user') || line.includes('model=agentToken'));
    expect(userTokenValues).toEqual(['FAKE_FIELD model=user method=update path=data key=isAdmin value=true']);

    // The admin joins its room; no agent membership is re-added.
    expect(countOf(writes(output), 'FAKE_WRITE roomParticipant.upsert')).toBe(1);
    expect(agentJoinedLines(output)).toEqual([]);

    expect(agentLines(output)).toEqual([
      '  agent: Ice \u{1F9CA} (exists, left unchanged)',
      '  agent: Lava \u{1F30B} (exists, left unchanged)',
    ]);
    expect(output).not.toContain('(updated)');
  }, 120_000);
});

describe('seed, existing sample agents without a token row', () => {
  it('creates the missing token (nothing to preserve) but no room membership', () => {
    const { status, output, error } = runSeed({ existing: ['lan', 'ice', 'lava'] });
    expect(error).toBeUndefined();
    expect(status).toBe(0);
    expect(output).toContain('Seed complete');

    expect(countOf(writes(output), 'FAKE_WRITE agentToken.create')).toBe(2);
    expect(writes(output)).not.toContain('FAKE_WRITE agentToken.update');
    expect(writes(output)).not.toContain('FAKE_WRITE user.create');
    expect(writes(output)).not.toContain('FAKE_WRITE user.upsert');
    expect(createdUsers(output)).toEqual([]);

    // The token is created with today\u0027s fields.
    expect(countOf(fields(output), TOKEN_CREATE_KEYS)).toBe(2);
    expect(countOf(values(output), 'FAKE_FIELD model=agentToken method=create path=data key=trustLevel value=elevated')).toBe(2);

    // The agents stay out of the rooms they were removed from.
    expect(countOf(writes(output), 'FAKE_WRITE roomParticipant.upsert')).toBe(1);
    expect(agentJoinedLines(output)).toEqual([]);

    expect(agentLines(output)).toEqual([
      '  agent: Ice \u{1F9CA} (exists, token created)',
      '  agent: Lava \u{1F30B} (exists, token created)',
    ]);
  }, 120_000);
});

describe('seed, the admin user behaves as before', () => {
  it('creates the admin with today\u0027s fields on a fresh database', () => {
    const { status, output } = runSeed({ existing: [] });
    expect(status).toBe(0);
    expect(countOf(fields(output), 'FAKE_FIELDS model=user method=upsert path=create keys=displayName,isAdmin,passwordHash,userType,username')).toBe(1);
    expect(countOf(writes(output), 'FAKE_WRITE roomParticipant.upsert')).toBe(3);
    expect(values(output)).toContain('FAKE_FIELD model=user method=upsert path=create key=isAdmin value=true');
    expect(values(output)).toContain('FAKE_FIELD model=user method=upsert path=create key=userType value=HUMAN');
  }, 120_000);

  it('only flags an existing admin and keeps joining it to the default rooms', () => {
    const { status, output } = runSeed({ existing: ['lan', 'ice', 'lava'], records: ['agentToken'] });
    expect(status).toBe(0);
    expect(writes(output)).toContain('FAKE_WRITE user.update');
    expect(writes(output)).not.toContain('FAKE_WRITE user.upsert');
    expect(countOf(writes(output), 'FAKE_WRITE roomParticipant.upsert')).toBe(1);
    expect(countOf(fields(output), 'FAKE_FIELDS model=user method=update path=data keys=isAdmin')).toBe(1);
  }, 120_000);
});
