// tests/api/usernameRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fastify from 'fastify';

// Mock Redis client before importing routes
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();
const mockMget = vi.fn();
const mockKeys = vi.fn();
const mockExec = vi.fn();

vi.mock('../../backend/shared/redisClient.js', () => ({
  redisClient: {
    getClient: () => ({
      get: mockGet,
      set: mockSet,
      del: mockDel,
      mget: mockMget,
      keys: mockKeys,
      pipeline: () => ({
        set: mockSet,
        del: mockDel,
        exec: mockExec,
      }),
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    ping: vi.fn().mockResolvedValue(true),
  },
}));

describe('Username Routes', () => {
  let app;
  let usernameRoutes;

  beforeAll(async () => {
    // Set up default mock behaviors
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue('OK');
    mockExec.mockResolvedValue([['OK'], ['OK']]);
    mockMget.mockResolvedValue([null, null]);
    mockKeys.mockResolvedValue([]);

    // Import routes after mocks are set up
    usernameRoutes = (await import('../../backend/fastify/routes/usernameRoutes.js')).default;
    
    app = fastify({ logger: false });
    await app.register(usernameRoutes, { prefix: '/api/usernames' });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('GET /api/usernames/:address', () => {
    it('should return null for non-existent username', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usernames/0x1234567890123456789012345678901234567890',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.username).toBeNull();
    });

    it('should reject invalid address format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usernames/invalid-address',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/usernames', () => {
    it('should set username for valid address', async () => {
      const testAddress = '0x' + '1'.repeat(40);
      const testUsername = 'testuser' + (Date.now() % 10000); // Keep under 20 chars

      // Mock Redis to return null for reverse lookup (username available)
      mockGet.mockResolvedValueOnce(null); // getAddressByUsername returns null
      mockGet.mockResolvedValueOnce(null); // getUsernameByAddress returns null
      mockExec.mockResolvedValueOnce([['OK'], ['OK']]); // pipeline exec succeeds

      const response = await app.inject({
        method: 'POST',
        url: '/api/usernames',
        payload: {
          address: testAddress,
          username: testUsername,
        },
      });

      const body = JSON.parse(response.body);
      
      // Debug: log response if not 200
      if (response.statusCode !== 200) {
        console.log('POST username failed:', body);
      }
      
      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.username).toBe(testUsername);
    });

    it('should reject username that is too short', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/usernames',
        payload: {
          address: '0x' + '2'.repeat(40),
          username: 'ab',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject username that is too long', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/usernames',
        payload: {
          address: '0x' + '3'.repeat(40),
          username: 'a'.repeat(21),
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject username with invalid characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/usernames',
        payload: {
          address: '0x' + '4'.repeat(40),
          username: 'test@user',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/usernames/check/:username', () => {
    it('should return available for new username', async () => {
      // Mock Redis to return null (username not taken)
      mockGet.mockResolvedValueOnce(null);

      const testUsername = 'unique' + (Date.now() % 10000); // Keep under 20 chars

      const response = await app.inject({
        method: 'GET',
        url: '/api/usernames/check/' + testUsername,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(true);
    });

    it('should return not available for invalid username', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usernames/check/ab',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.available).toBe(false);
    });
  });

  describe('GET /api/usernames/batch', () => {
    it('should return usernames for multiple addresses', async () => {
      const addr1 = '0x' + '5'.repeat(40);
      const addr2 = '0x' + '6'.repeat(40);

      const response = await app.inject({
        method: 'GET',
        url: `/api/usernames/batch?addresses=${addr1},${addr2}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty(addr1.toLowerCase());
      expect(body).toHaveProperty(addr2.toLowerCase());
    });

    it('should reject invalid addresses in batch', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/usernames/batch?addresses=invalid,0x' + '7'.repeat(40),
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
