// tests/api/userRoutes.test.js
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

vi.mock("../../shared/supabaseClient.js", () => ({
  db: {
    client: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      })),
    },
  },
}));

vi.mock("../../shared/usernameService.js", () => ({
  usernameService: {
    getAllUsernames: vi.fn(async () => [
      {
        address: "0x1234567890123456789012345678901234567890",
        username: "alice",
      },
    ]),
  },
}));

let userRoutesPlugin;
let app;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/userRoutes.js");
  userRoutesPlugin = mod.default || mod.userRoutes;
  app = fastify({ logger: false });
  await app.register(userRoutesPlugin);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("userRoutes (mocked)", () => {
  const existing = "0x1234567890123456789012345678901234567890";

  it("GET / returns username list", async () => {
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.players)).toBe(true);
    expect(body.count).toBe(1);
    expect(body.players[0].address).toBe(existing);
  });

  it("GET /:address/positions validates address", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/invalid-address/positions",
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /:address/positions returns positions", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${existing}/positions`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.positions)).toBe(true);
    expect(body.count).toBe(0);
  });
});
