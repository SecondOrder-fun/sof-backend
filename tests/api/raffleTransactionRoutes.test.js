// tests/api/raffleTransactionRoutes.test.js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fastify from "fastify";

const mockFrom = vi.fn();

vi.mock("../../shared/supabaseClient.js", () => ({
  db: {
    client: {
      from: (...args) => mockFrom(...args),
    },
  },
}));

// Mock viem client (used by syncSeasonTransactions, not by our new route)
vi.mock("../../src/lib/viemClient.js", () => ({
  publicClient: {},
}));

vi.mock("../../src/utils/blockRangeQuery.js", () => ({
  queryLogsInChunks: vi.fn(() => []),
}));

vi.mock("../../src/abis/SOFBondingCurveAbi.js", () => ({
  default: [],
}));

let app;

beforeAll(async () => {
  const mod = await import(
    "../../fastify/routes/raffleTransactionRoutes.js"
  );
  const raffleTransactionRoutes = mod.default || mod;
  app = fastify({ logger: false });
  await app.register(raffleTransactionRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /transactions/season/:seasonId", () => {
  it("should return transactions for a season", async () => {
    const mockTransactions = [
      {
        id: 1,
        season_id: 1,
        user_address: "0x1234",
        transaction_type: "BUY",
        ticket_amount: 10,
        tx_hash: "0xabc",
        block_number: 100,
        block_timestamp: "2024-01-15T10:00:00.000Z",
        tickets_before: 0,
        tickets_after: 10,
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({
              data: mockTransactions,
              error: null,
              count: 1,
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/transactions/season/1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.transactions).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.transactions[0].tx_hash).toBe("0xabc");
  });

  it("should respect limit and offset query params", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockImplementation((start, end) => {
              // Verify the range is computed correctly
              expect(start).toBe(10);
              expect(end).toBe(14); // offset(10) + limit(5) - 1
              return Promise.resolve({
                data: [],
                error: null,
                count: 0,
              });
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/transactions/season/1?limit=5&offset=10",
    });

    expect(res.statusCode).toBe(200);
  });

  it("should return 500 on database error", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB connection failed" },
              count: null,
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/transactions/season/1",
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("DB connection failed");
  });
});

describe("GET /holders/season/:seasonId", () => {
  it("should return aggregated holders (latest tx per user wins)", async () => {
    // Multiple rows for the same user — latest (highest block_number) should win
    const mockRows = [
      {
        user_address: "0xAlice",
        tickets_after: 50,
        block_number: 200,
        block_timestamp: "2024-01-16T10:00:00.000Z",
        id: 3,
      },
      {
        user_address: "0xAlice",
        tickets_after: 30,
        block_number: 100,
        block_timestamp: "2024-01-15T10:00:00.000Z",
        id: 1,
      },
      {
        user_address: "0xBob",
        tickets_after: 20,
        block_number: 150,
        block_timestamp: "2024-01-15T12:00:00.000Z",
        id: 2,
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: mockRows,
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/holders/season/1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalHolders).toBe(2);
    expect(body.totalTickets).toBe(70); // 50 + 20
    expect(body.holders).toHaveLength(2);
    // Sorted by current_tickets DESC
    expect(body.holders[0].user_address).toBe("0xAlice");
    expect(body.holders[0].current_tickets).toBe(50);
    expect(body.holders[0].transaction_count).toBe(2);
    expect(body.holders[1].user_address).toBe("0xBob");
    expect(body.holders[1].current_tickets).toBe(20);
    expect(body.holders[1].transaction_count).toBe(1);
  });

  it("should filter out 0-ticket holders (sold everything)", async () => {
    const mockRows = [
      {
        user_address: "0xAlice",
        tickets_after: 0,
        block_number: 200,
        block_timestamp: "2024-01-16T10:00:00.000Z",
        id: 2,
      },
      {
        user_address: "0xBob",
        tickets_after: 10,
        block_number: 150,
        block_timestamp: "2024-01-15T12:00:00.000Z",
        id: 1,
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: mockRows,
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/holders/season/1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalHolders).toBe(1);
    expect(body.holders[0].user_address).toBe("0xBob");
  });

  it("should return empty for season with no transactions", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/holders/season/99",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.holders).toEqual([]);
    expect(body.totalHolders).toBe(0);
    expect(body.totalTickets).toBe(0);
  });

  it("should return 500 on database error", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB connection failed" },
            }),
          }),
        }),
      }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/holders/season/1",
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("DB connection failed");
  });
});
