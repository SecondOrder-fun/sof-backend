// tests/api/allowlistRoutes.adminGuard.test.js
// @vitest-environment node
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import fastify from "fastify";

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn(async () => ({
    level: 0,
    levelName: "public",
    groups: [],
    entry: null,
  })),
  ACCESS_LEVELS: {
    PUBLIC: 0,
    CONNECTED: 1,
    ALLOWLIST: 2,
    BETA: 3,
    ADMIN: 4,
  },
}));

vi.mock("../../shared/allowlistService.js", () => ({
  isAllowlistWindowOpen: vi.fn(async () => ({ isOpen: true, config: null })),
  addToAllowlist: vi.fn(async () => ({ success: true, entry: { fid: 1 } })),
  removeFromAllowlist: vi.fn(async () => ({ success: true })),
  isWalletAllowlisted: vi.fn(async () => ({ isAllowlisted: false })),
  isFidAllowlisted: vi.fn(async () => ({ isAllowlisted: false })),
  getAllowlistEntries: vi.fn(async () => ({ entries: [], count: 0 })),
  getAllowlistStats: vi.fn(async () => ({ total: 0, active: 0 })),
  updateAllowlistConfig: vi.fn(async () => ({ success: true, config: {} })),
  retryPendingWalletResolutions: vi.fn(async () => ({
    resolved: 0,
    failed: 0,
  })),
}));

vi.mock("../../shared/fidResolverService.js", () => ({
  resolveFidToWallet: vi.fn(async () => ({
    address: "0x0000000000000000000000000000000000000000",
  })),
  bulkResolveFidsToWallets: vi.fn(async () => new Map()),
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: { client: { from: vi.fn() } },
}));

let allowlistRoutesPlugin;
let app;
let currentUser = null;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/allowlistRoutes.js");
  allowlistRoutesPlugin = mod.default;

  app = fastify({ logger: false });

  // Single hook used across tests to simulate auth context.
  app.addHook("preHandler", async (request) => {
    if (currentUser) {
      request.user = currentUser;
    }
  });

  await app.register(allowlistRoutesPlugin);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
});

describe("allowlistRoutes admin guard", () => {
  it("GET /stats returns 401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /stats returns 403 when not admin", async () => {
    const { getUserAccess } = await import("../../shared/accessService.js");
    getUserAccess.mockResolvedValueOnce({
      level: 2,
      levelName: "allowlist",
      groups: [],
      entry: { fid: 1 },
    });

    currentUser = {
      fid: 1,
      wallet_address: "0x1111111111111111111111111111111111111111",
    };

    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(403);
  });

  it("GET /stats returns 200 when admin", async () => {
    const { getUserAccess } = await import("../../shared/accessService.js");
    getUserAccess.mockResolvedValueOnce({
      level: 4,
      levelName: "admin",
      groups: [],
      entry: { fid: 1 },
    });

    currentUser = {
      fid: 1,
      wallet_address: "0x1111111111111111111111111111111111111111",
    };

    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
  });

  it("POST /add rejects wallet-only payload", async () => {
    const { getUserAccess } = await import("../../shared/accessService.js");
    getUserAccess.mockResolvedValueOnce({
      level: 4,
      levelName: "admin",
      groups: [],
      entry: { fid: 1 },
    });

    currentUser = {
      fid: 1,
      wallet_address: "0x1111111111111111111111111111111111111111",
    };

    const res = await app.inject({
      method: "POST",
      url: "/add",
      payload: { wallet: "0x2222222222222222222222222222222222222222" },
    });

    expect(res.statusCode).toBe(400);
  });
});
