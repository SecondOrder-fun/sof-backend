// tests/api/gatingRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fastify from "fastify";

// Build a chainable mock that mimics supabase-js query builder
function createChainMock(resolvedValue = { data: null, error: null }) {
  const chain = {
    from: vi.fn(() => chain),
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => resolvedValue),
    maybeSingle: vi.fn(() => resolvedValue),
    order: vi.fn(() => chain),
  };
  return chain;
}

let mockClient = createChainMock();

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: {
    get client() {
      return mockClient;
    },
  },
}));

import gatingRoutes from "../../fastify/routes/gatingRoutes.js";

describe("Gating Routes", () => {
  let app;

  beforeAll(async () => {
    app = fastify({ logger: false });
    await app.register(gatingRoutes, { prefix: "/api/gating" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to a successful mock by default
    mockClient = createChainMock({ data: null, error: null });
  });

  describe("POST /api/gating/signatures/:seasonId", () => {
    it("should store batch of signatures", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {
          signatures: [
            { address: "0xABC123", deadline: 1712345600, signature: "0xsig1" },
            { address: "0xDEF456", deadline: 1712345600, signature: "0xsig2" },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.count).toBe(2);
      // upsert should have been called twice (once per signature)
      expect(mockClient.upsert).toHaveBeenCalledTimes(2);
    });

    it("should lowercase addresses before storing", async () => {
      await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {
          signatures: [
            { address: "0xABC123", deadline: 1712345600, signature: "0xsig1" },
          ],
        },
      });

      expect(mockClient.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ participant_address: "0xabc123" }),
        expect.any(Object),
      );
    });

    it("should reject empty signatures array", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: { signatures: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should reject missing signatures key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain("signatures array required");
    });

    it("should reject more than 200 signatures", async () => {
      const sigs = Array.from({ length: 201 }, (_, i) => ({
        address: `0x${i.toString(16).padStart(40, "0")}`,
        deadline: 1712345600,
        signature: "0xsig",
      }));

      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: { signatures: sigs },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain("200");
    });

    it("should return 500 when upsert fails", async () => {
      mockClient = createChainMock({ data: null, error: { message: "DB error" } });
      // Make upsert return an error
      mockClient.upsert = vi.fn(() => ({
        data: null,
        error: { message: "DB error" },
      }));

      const res = await app.inject({
        method: "POST",
        url: "/api/gating/signatures/1",
        payload: {
          signatures: [
            { address: "0xABC", deadline: 1712345600, signature: "0xsig" },
          ],
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  describe("GET /api/gating/signature/:seasonId/:address", () => {
    it("should return signature for allowlisted address", async () => {
      mockClient = createChainMock({
        data: { signature: "0xabc", deadline: 1712345600, gate_index: 0 },
        error: null,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xABC123",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.signature).toBe("0xabc");
      expect(body.deadline).toBe(1712345600);
      expect(body.gateIndex).toBe(0);
    });

    it("should lowercase the address for lookup", async () => {
      mockClient = createChainMock({ data: null, error: null });

      await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xABC123",
      });

      // The second .eq() call should use the lowercased address
      const eqCalls = mockClient.eq.mock.calls;
      const addressCall = eqCalls.find(
        (call) => call[0] === "participant_address",
      );
      expect(addressCall[1]).toBe("0xabc123");
    });

    it("should return 404 for non-allowlisted address", async () => {
      mockClient = createChainMock({ data: null, error: null });

      const res = await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xNOTFOUND",
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 500 on database error", async () => {
      mockClient = createChainMock({
        data: null,
        error: { message: "Connection failed", code: "FATAL" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/gating/signature/1/0xABC",
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
