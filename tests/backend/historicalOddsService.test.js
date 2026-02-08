// tests/backend/historicalOddsService.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for HistoricalOddsService (Supabase-backed)
 * Tests odds recording, retrieval, cleanup, and downsampling.
 */

// Configurable mock results (updated per test)
let mockQueryResult = { data: [], error: null, count: null };

// Build a chainable query-builder mock that resolves to mockQueryResult
function chainable() {
  const chain = {};
  const methods = [
    "insert",
    "select",
    "delete",
    "eq",
    "gte",
    "lt",
    "not",
    "neq",
    "order",
    "limit",
  ];

  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }

  // single() terminates the chain and returns the result
  chain.single = vi.fn(() => ({
    data: mockQueryResult.data?.[0] ?? null,
    error: mockQueryResult.error,
  }));

  // Make chain thenable so `await query` resolves to mockQueryResult
  chain.then = (resolve) => resolve(mockQueryResult);

  return chain;
}

const mockFrom = vi.fn(() => chainable());

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  supabase: {
    from: (...args) => {
      mockFrom(...args);
      return chainable();
    },
  },
}));

import {
  historicalOddsService,
  historicalOddsRanges,
} from "../../shared/historicalOddsService.js";

describe("HistoricalOddsService (Supabase)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult = { data: [], error: null, count: null };
  });

  describe("recordOddsUpdate", () => {
    it("should call supabase insert with correct table and data", async () => {
      const oddsData = {
        timestamp: 1729260000000,
        yes_bps: 4500,
        no_bps: 5500,
        hybrid_bps: 4500,
        raffle_bps: 4200,
        sentiment_bps: 5000,
      };

      await historicalOddsService.recordOddsUpdate(1, 42, oddsData);

      expect(mockFrom).toHaveBeenCalledWith("infofi_odds_history");
    });

    it("should skip insert if no timestamp provided", async () => {
      await historicalOddsService.recordOddsUpdate(1, 0, {});
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should skip insert if oddsData is null", async () => {
      await historicalOddsService.recordOddsUpdate(1, 0, null);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it("should not throw on errors", async () => {
      mockQueryResult = { data: null, error: { message: "insert failed" } };

      await expect(
        historicalOddsService.recordOddsUpdate(1, 0, {
          timestamp: Date.now(),
          yes_bps: 5000,
          no_bps: 5000,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe("getHistoricalOdds", () => {
    it("should reject invalid time range", async () => {
      const result = await historicalOddsService.getHistoricalOdds(
        1,
        0,
        "INVALID",
      );
      expect(result.error).toBe("Invalid time range: INVALID");
      expect(result.dataPoints).toEqual([]);
    });

    it("should query correct table", async () => {
      mockQueryResult = { data: [], error: null };

      await historicalOddsService.getHistoricalOdds(1, 42, "ALL");

      expect(mockFrom).toHaveBeenCalledWith("infofi_odds_history");
    });

    it("should transform rows to match API contract", async () => {
      mockQueryResult = {
        data: [
          {
            recorded_at: "2025-10-18T12:00:00.000Z",
            yes_bps: 4500,
            no_bps: 5500,
            hybrid_bps: 4500,
            raffle_bps: 4200,
            sentiment_bps: 5000,
          },
        ],
        error: null,
      };

      const result = await historicalOddsService.getHistoricalOdds(1, 0, "ALL");

      expect(result.dataPoints).toHaveLength(1);
      expect(result.dataPoints[0]).toEqual({
        timestamp: new Date("2025-10-18T12:00:00.000Z").getTime(),
        yes_bps: 4500,
        no_bps: 5500,
        hybrid_bps: 4500,
        raffle_bps: 4200,
        sentiment_bps: 5000,
      });
      expect(result.count).toBe(1);
      expect(result.downsampled).toBe(false);
    });

    it("should return empty array on Supabase error", async () => {
      mockQueryResult = {
        data: null,
        error: { message: "query failed" },
      };

      const result = await historicalOddsService.getHistoricalOdds(1, 0, "1D");

      expect(result.dataPoints).toEqual([]);
      expect(result.count).toBe(0);
      expect(result.error).toBeDefined();
    });

    it("should downsample when exceeding max points", async () => {
      mockQueryResult = {
        data: Array.from({ length: 600 }, (_, i) => ({
          recorded_at: new Date(Date.now() - (600 - i) * 60000).toISOString(),
          yes_bps: 5000,
          no_bps: 5000,
          hybrid_bps: 5000,
          raffle_bps: 5000,
          sentiment_bps: 5000,
        })),
        error: null,
      };

      const result = await historicalOddsService.getHistoricalOdds(1, 0, "ALL");

      expect(result.count).toBeLessThanOrEqual(500);
      expect(result.downsampled).toBe(true);
    });

    it("should support all valid time ranges", async () => {
      mockQueryResult = { data: [], error: null };

      for (const range of ["1H", "6H", "1D", "1W", "1M", "ALL"]) {
        const result = await historicalOddsService.getHistoricalOdds(
          1,
          0,
          range,
        );
        expect(result.dataPoints).toEqual([]);
        expect(result.count).toBe(0);
      }
    });
  });

  describe("cleanupOldData", () => {
    it("should delete old records and return count", async () => {
      mockQueryResult = {
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
        error: null,
      };

      const removed = await historicalOddsService.cleanupOldData(1, 42);

      expect(mockFrom).toHaveBeenCalledWith("infofi_odds_history");
      expect(removed).toBe(3);
    });

    it("should handle cleanup errors gracefully", async () => {
      mockQueryResult = { data: null, error: { message: "delete failed" } };

      const removed = await historicalOddsService.cleanupOldData(1, 0);

      expect(removed).toBe(0);
    });
  });

  describe("clearMarketHistory", () => {
    it("should delete all records for a market", async () => {
      mockQueryResult = { data: null, error: null };

      const result = await historicalOddsService.clearMarketHistory(1, 42);

      expect(mockFrom).toHaveBeenCalledWith("infofi_odds_history");
      expect(result).toBe(true);
    });

    it("should return false on error", async () => {
      mockQueryResult = { data: null, error: { message: "delete failed" } };

      const result = await historicalOddsService.clearMarketHistory(1, 0);

      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return zero count when no data exists", async () => {
      mockQueryResult = { data: null, error: null, count: 0 };

      const stats = await historicalOddsService.getStats(1, 42);

      expect(stats.count).toBe(0);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
    });

    it("should handle errors gracefully", async () => {
      mockQueryResult = {
        data: null,
        error: { message: "query failed" },
        count: null,
      };

      const stats = await historicalOddsService.getStats(1, 0);

      expect(stats.count).toBe(0);
      expect(stats.error).toBeDefined();
    });
  });

  describe("_downsampleData", () => {
    it("should not downsample if under maxPoints", () => {
      const dataPoints = [
        {
          timestamp: 1000,
          yes_bps: 5000,
          no_bps: 5000,
          hybrid_bps: 5000,
          raffle_bps: 5000,
          sentiment_bps: 5000,
        },
        {
          timestamp: 2000,
          yes_bps: 5100,
          no_bps: 4900,
          hybrid_bps: 5100,
          raffle_bps: 5100,
          sentiment_bps: 5100,
        },
      ];

      const result = historicalOddsService._downsampleData(dataPoints, 500);
      expect(result).toEqual(dataPoints);
    });

    it("should average values when downsampling", () => {
      const dataPoints = [
        {
          timestamp: 1000,
          yes_bps: 4000,
          no_bps: 6000,
          hybrid_bps: 4000,
          raffle_bps: 4000,
          sentiment_bps: 4000,
        },
        {
          timestamp: 2000,
          yes_bps: 6000,
          no_bps: 4000,
          hybrid_bps: 6000,
          raffle_bps: 6000,
          sentiment_bps: 6000,
        },
      ];

      const result = historicalOddsService._downsampleData(dataPoints, 1);

      expect(result).toHaveLength(1);
      expect(result[0].yes_bps).toBe(5000);
      expect(result[0].no_bps).toBe(5000);
      expect(result[0].timestamp).toBe(1500);
    });
  });

  describe("_getRangeStart", () => {
    it("should return correct offsets for each range", () => {
      const now = Date.now();

      expect(historicalOddsService._getRangeStart("1H", now)).toBe(
        now - 3600000,
      );
      expect(historicalOddsService._getRangeStart("6H", now)).toBe(
        now - 21600000,
      );
      expect(historicalOddsService._getRangeStart("1D", now)).toBe(
        now - 86400000,
      );
      expect(historicalOddsService._getRangeStart("1W", now)).toBe(
        now - 604800000,
      );
      expect(historicalOddsService._getRangeStart("1M", now)).toBe(
        now - 2592000000,
      );
      expect(historicalOddsService._getRangeStart("ALL", now)).toBe(0);
    });
  });

  describe("historicalOddsRanges", () => {
    it("should export all valid ranges", () => {
      expect(historicalOddsRanges).toEqual(
        expect.arrayContaining(["1H", "6H", "1D", "1W", "1M", "ALL"]),
      );
      expect(historicalOddsRanges).toHaveLength(6);
    });
  });
});
