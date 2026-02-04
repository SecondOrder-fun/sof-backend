import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Redis and Supabase before importing blockCursor
vi.mock("../../shared/redisClient.js", () => ({
  redisClient: {
    client: null,
    isConnected: false,
    connect: vi.fn(),
  },
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  supabase: {
    from: vi.fn(),
  },
  hasSupabase: false,
}));

describe("blockCursor", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falls back to in-memory when no Redis or Supabase available", async () => {
    const { createBlockCursor } = await import("../../src/lib/blockCursor.js");

    const cursor = await createBlockCursor("test:event");

    // Initially null
    const initial = await cursor.get();
    expect(initial).toBeNull();

    // Set and get
    await cursor.set(12345n);
    const stored = await cursor.get();
    expect(stored).toBe(12345n);

    // Overwrite
    await cursor.set(99999n);
    const updated = await cursor.get();
    expect(updated).toBe(99999n);
  });
});
