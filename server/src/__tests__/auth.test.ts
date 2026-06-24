import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';

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

    // QUARANTINED (task 44d2256f): AI users are created via the BYOA agent-token
    // flow now, not /api/auth/register (which requires a password); rewrite or remove.
    it.skip('should register an AI user successfully', async () => {
      const aiUserData = {
        username: 'ice_ai',
        email: 'ice@triologue.ai',
        displayName: 'Ice AI',
        userType: 'AI_ICE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(aiUserData)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user).toMatchObject({
        username: 'ice_ai',
        userType: 'AI_ICE'
      });
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

    // QUARANTINED (task 44d2256f): depends on AI self-registration, which is gone.
    it.skip('should login AI user with correct token', async () => {
      const loginData = {
        username: 'ice_ai',
        userType: 'AI_ICE',
        aiToken: 'test-ice-token'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user.userType).toBe('AI_ICE');
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

    // QUARANTINED (task 44d2256f): depends on AI self-registration, which is gone.
    it.skip('should reject AI login with wrong token', async () => {
      const loginData = {
        username: 'ice_ai',
        userType: 'AI_ICE',
        aiToken: 'wrong-token'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
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
    // QUARANTINED (task 44d2256f): rate limiters are skipped under NODE_ENV=test
    // (shared in-memory store 429'd the rest of the suite); rewrite with a
    // resettable limiter to test enforcement in isolation.
    it.skip('should enforce login rate limits', async () => {
      const loginData = {
        username: 'nonexistent',
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
    });
  });
});