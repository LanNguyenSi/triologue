import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import { authTestOverrides } from '../routes/auth';

const prisma = new PrismaClient();

// This is a Prisma-backed integration test: it hits a real database
// (beforeAll `deleteMany`, register/login round-trips via supertest), so
// it cannot run in an environment without a reachable test database. It
// is skipped unless RUN_DB_TESTS is set, mirroring the gating in
// agent-tasks-mcp-live.test.ts. Required env (including DATABASE_URL) is
// provided by jest.setup.js; point DATABASE_URL at a real test database
// when opting in.
const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

describeOrSkip('Auth Routes', () => {
  beforeAll(async () => {
    // Clean up test database
    await prisma.messageReaction.deleteMany();
    await prisma.message.deleteMany();
    await prisma.roomParticipant.deleteMany();
    await prisma.room.deleteMany();
    // agentToken.createdById has no onDelete cascade (unlike userId, which
    // cascades on the agent's own user row), so it must go before
    // user.deleteMany() below — otherwise a leftover row from a prior run of
    // this file (e.g. the BYOA agent created in the describe further down)
    // still references its creator user and user.deleteMany() 500s on a
    // foreign key violation instead of giving every test a clean slate.
    await prisma.agentToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('should register a human user successfully', async () => {
      const userData = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password123',
        displayName: 'Test User',
        userType: 'HUMAN'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toMatchObject({
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        userType: 'HUMAN'
      });
      expect(response.body.user).not.toHaveProperty('passwordHash');
    });

    // Rewritten (task 44d2256f): AI users are no longer created via this route
    // (that required a password and predates the BYOA flow). Today, any
    // client-supplied non-HUMAN userType is rejected outright, independent
    // of REGISTRATION_MODE — see routes/auth.ts. The real AI-provisioning
    // path (POST /api/agents → BYOA token → login) is covered below in
    // "AI agent auth via BYOA".
    it('should reject AI self-registration with 403 (AI accounts are provisioned via BYOA, not this route)', async () => {
      const aiUserData = {
        username: 'ice_ai',
        email: 'ice@triologue.ai',
        // The register schema requires `password` unconditionally (unlike
        // login), so a realistic attacker payload includes one even for a
        // self-declared AI userType — see authRegistrationModes.test.ts.
        password: 'Password123',
        displayName: 'Ice AI',
        userType: 'AI_ICE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(aiUserData)
        .expect(403);

      expect(response.body.error).toBe('Self-registration is only available for human accounts.');
    });

    it('should reject registration with invalid data', async () => {
      const invalidData = {
        username: 'ab', // too short
        email: 'invalid-email',
        password: 'weak',
        displayName: '',
        userType: 'HUMAN'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toBeInstanceOf(Array);
    });

    it('should reject duplicate username', async () => {
      const userData = {
        username: 'testuser', // already exists
        email: 'different@example.com',
        password: 'Password123',
        displayName: 'Different User',
        userType: 'HUMAN'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body.error).toBe('Username already taken.');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login human user with correct credentials', async () => {
      const loginData = {
        username: 'testuser',
        password: 'Password123',
        userType: 'HUMAN'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toMatchObject({
        username: 'testuser',
        userType: 'HUMAN'
      });
    });

    it('should reject login with wrong password', async () => {
      const loginData = {
        username: 'testuser',
        password: 'WrongPassword123',
        userType: 'HUMAN'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error).toBe('Invalid credentials');
    });
  });

  // Rewritten (task 44d2256f): the two AI-login cases previously here assumed
  // AI self-registration via POST /api/auth/register, which no longer
  // exists. AI accounts are provisioned exclusively through the authenticated
  // BYOA agent-token flow (routes/agents.ts: POST /api/agents, any
  // authenticated user, tiered activation via canTriggerAI). This suite is
  // the only integration coverage that exercises real DB creation of a BYOA
  // agent and its login round-trip — grep confirms agent-mcp-endpoints.test.ts
  // and the other agent-*/byoa-adjacent suites either mock prisma/middleware
  // entirely or never call POST /api/agents, so there is no overlap to avoid.
  describe('AI agent auth via BYOA (POST /api/agents + login)', () => {
    let agentUsername: string;
    let agentToken: string;

    beforeAll(async () => {
      // POST /api/agents unconditionally upserts the new agent into a
      // hidden "registration" staging room (routes/agents.ts, HIDDEN_ROOM_IDS
      // in utils/projectRoomPolicy.ts). That room is provisioned outside the
      // normal room UI (ops bootstrap) and isn't seeded by prisma db push /
      // this file's top-level `room.deleteMany()`, so create it here —
      // fixture setup for a route precondition, not a route-behavior change.
      await prisma.room.upsert({
        where: { id: 'registration' },
        create: { id: 'registration', name: 'registration', isPrivate: true },
        update: {},
      });

      // A human "creator" registers and logs in first — POST /api/agents
      // requires an authenticated caller (any authenticated user may create
      // an agent; see routes/agents.ts).
      const creatorData = {
        username: 'byoa_creator',
        email: 'byoa_creator@example.com',
        password: 'Password123',
        displayName: 'BYOA Creator',
        userType: 'HUMAN'
      };
      await request(app).post('/api/auth/register').send(creatorData).expect(201);

      const creatorLogin = await request(app)
        .post('/api/auth/login')
        .send({ username: creatorData.username, password: creatorData.password, userType: 'HUMAN' })
        .expect(200);
      const creatorToken = creatorLogin.body.token;

      const createRes = await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ name: 'ByoaTestAgent' })
        .expect(201);

      agentUsername = createRes.body.agentUsername;
      agentToken = createRes.body.token;
      // The creator has the default canTriggerAI: true (Prisma schema
      // default), so the agent auto-activates (standard trust,
      // mentions-only) without needing a separate admin-approval step.
      expect(createRes.body.status).toBe('active');
    });

    it('creates an active BYOA agent and returns a one-time token', () => {
      expect(agentUsername).toMatch(/^agent_byoatestagent_/);
      expect(agentToken).toMatch(/^byoa_/);
    });

    it('should login AI user with correct token', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: agentUsername, userType: 'AI_AGENT', aiToken: agentToken })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user.userType).toBe('AI_AGENT');
      expect(response.body.user.username).toBe(agentUsername);
    });

    it('should reject AI login with wrong token', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: agentUsername, userType: 'AI_AGENT', aiToken: 'byoa_wrong_token_0000000000000000' })
        .expect(401);

      expect(response.body.error).toBe('Invalid AI token');
    });
  });

  describe('GET /api/auth/verify', () => {
    let userToken: string;

    beforeAll(async () => {
      // Get a valid token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'Password123',
          userType: 'HUMAN'
        });
      userToken = loginResponse.body.token;
    });

    it('should verify valid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.user).toHaveProperty('username', 'testuser');
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Invalid token');
    });

    it('should reject missing token', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .expect(401);

      expect(response.body.error).toBe('No token provided');
    });
  });

  describe('GET /api/auth/profile', () => {
    let userToken: string;

    beforeAll(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'Password123',
          userType: 'HUMAN'
        });
      userToken = loginResponse.body.token;
    });

    it('should get user profile with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        username: 'testuser',
        displayName: 'Test User',
        userType: 'HUMAN'
      });
      expect(response.body).toHaveProperty('_count');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('should reject unauthorized request', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .expect(401);

      expect(response.body.error).toBe('Authentication required');
    });
  });

  describe('PATCH /api/auth/me', () => {
    let userToken: string;

    beforeAll(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'Password123',
          userType: 'HUMAN'
        });
      userToken = loginResponse.body.token;
    });

    it('updates the profile and omits passwordHash and authToken from the response', async () => {
      // Give the user a real (non-null) authToken first, so the assertions prove
      // an actual secret value is suppressed, not merely that a null key is absent.
      await prisma.user.update({
        where: { username: 'testuser' },
        data: { authToken: 'SENTINEL_AUTH_TOKEN' },
      });

      const response = await request(app)
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ displayName: 'Renamed User' })
        .expect(200);

      expect(response.body.user).toMatchObject({ displayName: 'Renamed User' });
      // Defense-in-depth: a profile update must not echo secrets back.
      expect(response.body.user).not.toHaveProperty('passwordHash');
      expect(response.body.user).not.toHaveProperty('authToken');
      expect(JSON.stringify(response.body)).not.toContain('SENTINEL_AUTH_TOKEN');
    });
  });

  describe('PUT /api/auth/change-password', () => {
    let userToken: string;

    beforeAll(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'Password123',
          userType: 'HUMAN'
        });
      userToken = loginResponse.body.token;
    });

    it('should change password with valid current password', async () => {
      const changeData = {
        currentPassword: 'Password123',
        newPassword: 'NewPassword456'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${userToken}`)
        .send(changeData)
        .expect(200);

      expect(response.body.message).toBe('Password changed successfully');

      // Verify login with new password
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'NewPassword456',
          userType: 'HUMAN'
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('token');
    });

    it('should reject change with wrong current password', async () => {
      const changeData = {
        currentPassword: 'WrongPassword',
        newPassword: 'NewPassword789'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${userToken}`)
        .send(changeData)
        .expect(401);

      expect(response.body.error).toBe('Current password is incorrect');
    });
  });

  describe('POST /api/auth/logout', () => {
    let userToken: string;

    beforeAll(async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'NewPassword456', // updated password from previous test
          userType: 'HUMAN'
        });
      userToken = loginResponse.body.token;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.message).toBe('Logged out successfully');
    });

    it('should handle logout without token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(200);

      expect(response.body.message).toBe('Logged out successfully');
    });
  });

  describe('Rate Limiting', () => {
    // Rewritten (task 44d2256f): loginLimit's skip() unconditionally bypasses
    // the limiter under NODE_ENV==='test' — the shared in-memory store would
    // otherwise accumulate across every login call in this whole file and
    // 429 unrelated cases. authTestOverrides.loginLimitActive (routes/auth.ts)
    // is a test-only escape hatch: flipping it true re-enables loginLimit for
    // exactly the duration of this test, so it alone exercises the real
    // limiter. It is always flipped back in `finally`, even on assertion
    // failure, so a later test in this file never inherits a live limiter.
    // No earlier test in this file ever incremented the store for this IP
    // (the flag was false for all of them), so the counter starts at 0 here
    // without needing an explicit resetKey.
    it('should enforce login rate limits', async () => {
      authTestOverrides.loginLimitActive = true;
      try {
        const loginData = {
          username: 'ratelimit_probe',
          password: 'wrongpassword',
          userType: 'HUMAN'
        };

        // Make multiple failed login attempts
        for (let i = 0; i < 5; i++) {
          await request(app)
            .post('/api/auth/login')
            .send(loginData)
            .expect(401);
        }

        // 6th attempt should be rate limited
        const response = await request(app)
          .post('/api/auth/login')
          .send(loginData)
          .expect(429);

        expect(response.body.error).toContain('Too many login attempts');
      } finally {
        authTestOverrides.loginLimitActive = false;
      }
    });
  });
});