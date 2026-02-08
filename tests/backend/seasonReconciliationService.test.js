/**
 * @file seasonReconciliationService.test.js
 * @description Unit tests for season reconciliation (backfill season_contracts from chain)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  mockPublicClient: {
    readContract: vi.fn(),
  },
}));

const dbMocks = vi.hoisted(() => ({
  mockGetSeasonContracts: vi.fn(),
  mockCreateSeasonContracts: vi.fn(),
}));

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: viemMocks.mockPublicClient,
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  hasSupabase: true,
  db: {
    getSeasonContracts: (...args) => dbMocks.mockGetSeasonContracts(...args),
    createSeasonContracts: (...args) => dbMocks.mockCreateSeasonContracts(...args),
  },
}));

import { reconcileSeasonsFromChain } from "../../src/services/seasonReconciliationService.js";

describe("reconcileSeasonsFromChain", () => {
  /** @type {{ info: any, warn: any, error: any, debug: any }} */
  let logger;

  beforeEach(() => {
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    viemMocks.mockPublicClient.readContract.mockReset();
    dbMocks.mockGetSeasonContracts.mockReset();
    dbMocks.mockCreateSeasonContracts.mockReset();
  });

  it("upserts missing seasons and starts listeners for active seasons", async () => {
    // currentSeasonId = 3
    viemMocks.mockPublicClient.readContract.mockImplementation(
      async ({ functionName, args }) => {
        if (functionName === "currentSeasonId") return 3n;
        if (functionName === "getSeasonDetails") {
          const sid = Number(args?.[0] ?? 0n);
          return [
            {
              raffleToken: `0x00000000000000000000000000000000000000${sid}`,
              bondingCurve: `0x00000000000000000000000000000000000000a${sid}`,
              isActive: sid === 3,
            },
            1,
            0,
            0,
            0,
          ];
        }
        throw new Error(`Unexpected functionName: ${functionName}`);
      },
    );

    // No seasons exist yet
    dbMocks.mockGetSeasonContracts.mockResolvedValue(null);

    const onSeasonActive = vi.fn();

    const result = await reconcileSeasonsFromChain({
      raffleAddress: "0x1111111111111111111111111111111111111111",
      raffleAbi: [],
      logger,
      onSeasonActive,
    });

    expect(result.latestSeasonId).toBe(3);
    expect(result.inspected).toBe(3);
    expect(result.upserted).toBe(3);
    expect(result.activated).toBe(1);

    expect(dbMocks.mockCreateSeasonContracts).toHaveBeenCalledTimes(3);
    expect(onSeasonActive).toHaveBeenCalledTimes(1);
    expect(onSeasonActive).toHaveBeenCalledWith({
      seasonId: 3,
      bondingCurveAddress: "0x00000000000000000000000000000000000000a3",
      raffleTokenAddress: "0x000000000000000000000000000000000000003",
    });
  });

  it("does not upsert when season_contracts already matches and season is inactive", async () => {
    viemMocks.mockPublicClient.readContract.mockImplementation(
      async ({ functionName, args }) => {
        if (functionName === "currentSeasonId") return 1n;
        if (functionName === "getSeasonDetails") {
          const sid = Number(args?.[0] ?? 0n);
          return [
            {
              raffleToken: `0x00000000000000000000000000000000000000${sid}`,
              bondingCurve: `0x00000000000000000000000000000000000000a${sid}`,
              isActive: false,
            },
            5,
            0,
            0,
            0,
          ];
        }
        throw new Error(`Unexpected functionName: ${functionName}`);
      },
    );

    dbMocks.mockGetSeasonContracts.mockResolvedValue({
      season_id: 1,
      bonding_curve_address: "0x00000000000000000000000000000000000000a1",
      raffle_token_address: "0x000000000000000000000000000000000000001",
      raffle_address: "0x1111111111111111111111111111111111111111",
      is_active: false,
    });

    const onSeasonActive = vi.fn();

    const result = await reconcileSeasonsFromChain({
      raffleAddress: "0x1111111111111111111111111111111111111111",
      raffleAbi: [],
      logger,
      onSeasonActive,
    });

    expect(result.latestSeasonId).toBe(1);
    expect(result.upserted).toBe(0);
    expect(result.activated).toBe(0);
    expect(dbMocks.mockCreateSeasonContracts).not.toHaveBeenCalled();
    expect(onSeasonActive).not.toHaveBeenCalled();
  });
});
