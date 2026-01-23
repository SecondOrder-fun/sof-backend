// tests/api/accessRoutes.adminGuard.test.js
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
  checkRouteAccess: vi.fn(async () => ({ hasAccess: true })),
  getRouteConfig: vi.fn(async () => null),
  setUserAccessLevel: vi.fn(async () => ({ success: true, entry: { fid: 1 } })),
  getDefaultAccessLevel: vi.fn(async () => 2),
  setDefaultAccessLevel: vi.fn(async () => ({ success: true })),
  ACCESS_LEVELS: {
    PUBLIC: 0,
    CONNECTED: 1,
    ALLOWLIST: 2,
    BETA: 3,
    ADMIN: 4,
  },
  ACCESS_LEVEL_NAMES: {
    0: "public",
    1: "connected",
    2: "allowlist",
    3: "beta",
    4: "admin",
  },
}));

let accessRoutesPlugin;
let app;
let currentUser = null;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/accessRoutes.js");
  accessRoutesPlugin = mod.default;

  app = fastify({ logger: false });
  app.addHook("preHandler", async (request) => {
    if (currentUser) request.user = currentUser;
  });

  await app.register(accessRoutesPlugin);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
});

describe("accessRoutes admin guard", () => {
  it("POST /set-default-level returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/set-default-level",
      payload: { level: 2 },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /set-default-level returns 403 when not admin", async () => {
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

    const res = await app.inject({
      method: "POST",
      url: "/set-default-level",
      payload: { level: 2 },
    });

    expect(res.statusCode).toBe(403);
  });

  it("POST /set-default-level returns 200 when admin", async () => {
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
      url: "/set-default-level",
      payload: { level: 2 },
    });

    expect(res.statusCode).toBe(200);
  });
});
