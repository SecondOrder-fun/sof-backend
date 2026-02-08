// tests/api/infoFiAdminRoutes.test.js
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import Fastify from "fastify";
import infoFiRoutes from "../../fastify/routes/infoFiRoutes.js";

vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: { readContract: vi.fn() },
  getPublicClient: vi.fn(),
}));

vi.mock("../../src/config/chain.js", () => ({
  getChainByKey: vi.fn(),
}));

vi.mock("../../shared/pricingService.js", () => ({
  pricingService: {
    getCachedPricing: vi.fn(),
    subscribeToMarket: vi.fn(() => () => {}),
  },
}));

vi.mock("../../shared/marketMakerService.js", () => ({
  marketMakerService: {
    quote: vi.fn(),
    buy: vi.fn(),
    sell: vi.fn(),
  },
}));

vi.mock("../../shared/supabaseClient.js", () => ({
  supabase: {
    from: vi.fn(),
  },
  db: {
    getInfoFiMarketById: vi.fn(),
  },
}));

import { supabase } from "../../shared/supabaseClient.js";

describe("InfoFi Admin Summary Route", () => {
  let app;

  beforeAll(async () => {
    app = Fastify();
    await app.register(infoFiRoutes, { prefix: "/api/infofi" });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty summary when no markets exist", async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        data: [],
        error: null,
      })),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/infofi/markets/admin-summary",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.totalMarkets).toBe(0);
    expect(body.totalSeasons).toBe(0);
    expect(body.seasons).toEqual({});
  });

  it("should handle database errors gracefully", async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        data: null,
        error: { message: "Database connection failed" },
      })),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/infofi/markets/admin-summary",
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe("Failed to fetch markets summary");
    expect(body.details).toBe("Database connection failed");
  });

  it("should group markets by season", async () => {
    const mockMarkets = [
      {
        id: 1,
        season_id: 1,
        is_active: true,
        is_settled: false,
        market_type: "WINNER_PREDICTION",
      },
      {
        id: 2,
        season_id: 1,
        is_active: true,
        is_settled: false,
        market_type: "POSITION_SIZE",
      },
      {
        id: 3,
        season_id: 2,
        is_active: false,
        is_settled: true,
        market_type: "WINNER_PREDICTION",
      },
    ];

    supabase.from.mockReturnValueOnce({
      select: vi.fn(() => ({
        data: mockMarkets,
        error: null,
      })),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/infofi/markets/admin-summary",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.totalMarkets).toBe(3);
    expect(body.totalSeasons).toBe(2);
    expect(body.seasons["1"].totalMarkets).toBe(2);
    expect(body.seasons["1"].activeMarkets).toBe(2);
    expect(body.seasons["2"].settledMarkets).toBe(1);
    expect(body.seasons["1"].marketsByType.WINNER_PREDICTION).toBe(1);
  });
});
