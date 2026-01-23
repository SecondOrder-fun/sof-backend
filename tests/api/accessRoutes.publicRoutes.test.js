// tests/api/accessRoutes.publicRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fastify from "fastify";

vi.mock("../../shared/accessService.js", () => ({
  getUserAccess: vi.fn(async () => ({
    level: 0,
    levelName: "public",
    groups: [],
    entry: null,
  })),
  checkRouteAccess: vi.fn(async ({ route }) => ({
    hasAccess: true,
    reason: "public_override",
    userLevel: 0,
    requiredLevel: 0,
    requiredGroups: [],
    userGroups: [],
    isPublicOverride: route === "/raffles" || route === "/portfolio",
    isDisabled: false,
    routeConfig: {
      route_pattern: route,
      required_level: 0,
      is_public: false,
      is_disabled: false,
    },
  })),
  getRouteConfig: vi.fn(async () => null),
  setUserAccessLevel: vi.fn(async () => ({ success: true })),
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

let plugin;
let app;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/accessRoutes.js");
  plugin = mod.default;

  app = fastify({ logger: false });
  await app.register(plugin);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

describe("accessRoutes public routes", () => {
  it("GET /check-access allows anonymous checks (no fid/wallet)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/check-access?route=%2Fraffles",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("hasAccess");
  });
});
