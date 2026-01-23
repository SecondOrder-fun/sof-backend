// tests/api/farcasterWebhookRoutes.verification.test.js
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

// Ensure env required by route module is present before dynamic import.
process.env.NEYNAR_API_KEY = "test";

vi.mock("@farcaster/miniapp-node", () => ({
  parseWebhookEvent: vi.fn(async () => ({
    header: { fid: 123, key: "appKey" },
    payload: {
      event: "miniapp_added",
      notificationDetails: { url: "u", token: "t" },
    },
  })),
  verifyAppKeyWithNeynar: vi.fn(),
}));

vi.mock("../../shared/allowlistService.js", () => ({
  addToAllowlist: vi.fn(async () => ({ success: true, entry: { fid: 123 } })),
  removeFromAllowlist: vi.fn(async () => ({ success: true })),
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: {
    client: {
      from: vi.fn(() => ({
        upsert: vi.fn(async () => ({ data: [], error: null })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        })),
      })),
    },
  },
}));

let plugin;
let app;

beforeAll(async () => {
  const mod = await import("../../fastify/routes/farcasterWebhookRoutes.js");
  plugin = mod.default;
  app = fastify({ logger: false });
  await app.register(plugin);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("farcasterWebhookRoutes verification", () => {
  it("ignores unverified payload format", async () => {
    const { addToAllowlist } = await import("../../shared/allowlistService.js");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/farcaster",
      payload: { event: "miniapp_added", fid: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(addToAllowlist).not.toHaveBeenCalled();
  });

  it("calls addToAllowlist when verified miniapp_added", async () => {
    const { addToAllowlist } = await import("../../shared/allowlistService.js");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/farcaster",
      payload: { header: "h", payload: "p", signature: "s" },
    });

    expect(res.statusCode).toBe(200);
    expect(addToAllowlist).toHaveBeenCalledWith(123, "webhook");
  });

  it("revokes allowlist when verified miniapp_removed", async () => {
    const { parseWebhookEvent } = await import("@farcaster/miniapp-node");
    parseWebhookEvent.mockResolvedValueOnce({
      header: { fid: 123, key: "appKey" },
      payload: { event: "miniapp_removed" },
    });

    const { removeFromAllowlist } =
      await import("../../shared/allowlistService.js");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/farcaster",
      payload: { header: "h", payload: "p", signature: "s" },
    });

    expect(res.statusCode).toBe(200);
    expect(removeFromAllowlist).toHaveBeenCalledWith(123);
  });

  it("does not mutate state when signature verification fails", async () => {
    const { parseWebhookEvent } = await import("@farcaster/miniapp-node");
    parseWebhookEvent.mockRejectedValueOnce(
      Object.assign(new Error("bad"), {
        name: "VerifyJsonFarcasterSignature.InvalidDataError",
      }),
    );

    const { addToAllowlist, removeFromAllowlist } =
      await import("../../shared/allowlistService.js");

    const res = await app.inject({
      method: "POST",
      url: "/webhook/farcaster",
      payload: { header: "h", payload: "p", signature: "s" },
    });

    expect(res.statusCode).toBe(200);
    expect(addToAllowlist).not.toHaveBeenCalled();
    expect(removeFromAllowlist).not.toHaveBeenCalled();
  });
});
