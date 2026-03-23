// tests/api/paymasterProxy.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

const mockRedisClient = {
  set: vi.fn().mockResolvedValue("OK"),
  get: vi.fn().mockResolvedValue(null),
};

vi.mock("../../shared/redisClient.js", () => ({
  redisClient: { getClient: () => mockRedisClient },
}));

vi.mock("../../shared/auth.js", () => ({
  AuthService: { authenticateRequest: vi.fn().mockResolvedValue({ id: "user1", fid: 13837 }) },
}));

let app;
let AuthService;

beforeAll(async () => {
  // Import mocked AuthService for spy access
  const authMod = await import("../../shared/auth.js");
  AuthService = authMod.AuthService;

  const mod = await import("../../fastify/routes/paymasterProxyRoutes.js");
  const paymasterProxyRoutes = mod.default;

  app = fastify({ logger: false });
  await app.register(paymasterProxyRoutes);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mock behaviour after clearAllMocks
  AuthService.authenticateRequest.mockResolvedValue({ id: "user1", fid: 13837 });
  mockRedisClient.set.mockResolvedValue("OK");
});

describe("POST /session", () => {
  it("returns 401 when auth fails", async () => {
    AuthService.authenticateRequest.mockRejectedValueOnce(new Error("Invalid token"));

    const res = await app.inject({
      method: "POST",
      url: "/session",
      headers: { authorization: "Bearer bad-token" },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Authentication required");
  });

  it("returns 200 with sessionToken when authenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/session",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.sessionToken).toBe("string");
    expect(body.sessionToken.length).toBeGreaterThan(0);
    // UUID without hyphens: 32 hex chars
    expect(body.sessionToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it("stores token in Redis with paymaster:session: prefix and 300s TTL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/session",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const { sessionToken } = JSON.parse(res.body);

    expect(mockRedisClient.set).toHaveBeenCalledOnce();
    const [key, value, exFlag, ttl] = mockRedisClient.set.mock.calls[0];
    expect(key).toBe(`paymaster:session:${sessionToken}`);
    expect(value).toBe("1");
    expect(exFlag).toBe("EX");
    expect(ttl).toBe(300);
  });
});
