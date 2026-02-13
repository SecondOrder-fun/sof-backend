// backend/fastify/routes/infoFiRoutes.js
import { supabase, db } from "../../shared/supabaseClient.js";
import { publicClient } from "../../src/lib/viemClient.js";
import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";
import {
  historicalOddsService,
  historicalOddsRanges,
} from "../../shared/historicalOddsService.js";

/**
 * InfoFi Markets API Routes
 * Provides endpoints for fetching prediction market data from Supabase
 */
export default async function infoFiRoutes(fastify) {
  /**
   * GET /api/infofi/markets
   * Get all markets, optionally filtered by season, status, or type
   *
   * Query params:
   * - seasonId: Filter by season (optional)
   * - isActive: Filter by active status (optional, boolean)
   * - marketType: Filter by market type (optional)
   *
   * Returns: { markets: { "1": [...], "2": [...] } }
   */
  fastify.get("/markets", async (request, reply) => {
    try {
      const { seasonId, isActive, marketType } = request.query;

      // Build query with optional filters
      let query = supabase
        .from("infofi_markets")
        .select(
          `
          id,
          season_id,
          player_address,
          player_id,
          market_type,
          contract_address,
          current_probability_bps,
          is_active,
          is_settled,
          settlement_time,
          winning_outcome,
          created_at,
          updated_at
        `,
        )
        .order("created_at", { ascending: false });

      // Apply filters if provided
      if (seasonId) {
        query = query.eq("season_id", seasonId);
      }

      if (isActive !== undefined) {
        query = query.eq("is_active", isActive === "true");
      }

      if (marketType) {
        query = query.eq("market_type", marketType);
      }

      const { data, error } = await query;

      if (error) {
        fastify.log.error({ error }, "Failed to fetch markets");
        return reply.code(500).send({
          error: "Failed to fetch markets",
          details: error.message,
        });
      }

      // Group markets by season_id
      const marketsBySeason = {};

      if (data && Array.isArray(data)) {
        for (const market of data) {
          const sid = String(market.season_id);
          if (!marketsBySeason[sid]) {
            marketsBySeason[sid] = [];
          }

          // Transform to match frontend expectations
          marketsBySeason[sid].push({
            id: market.id,
            seasonId: market.season_id,
            raffle_id: market.season_id, // Alias for backward compatibility
            player: market.player_address,
            player_address: market.player_address,
            player_id: market.player_id,
            market_type: market.market_type,
            contract_address: market.contract_address,
            current_probability_bps: market.current_probability_bps,
            current_probability: market.current_probability_bps, // Alias
            is_active: market.is_active,
            is_settled: market.is_settled,
            settlement_time: market.settlement_time,
            winning_outcome: market.winning_outcome,
            created_at: market.created_at,
            updated_at: market.updated_at,
          });
        }
      }

      return reply.send({
        markets: marketsBySeason,
        total: data?.length || 0,
      });
    } catch (error) {
      fastify.log.error({ error }, "Unexpected error fetching markets");
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/markets/:marketId
   * Get a single market by ID
   *
   * Returns: { market: {...} }
   */
  fastify.get("/markets/:marketId", async (request, reply) => {
    try {
      const { marketId } = request.params;

      const { data, error } = await supabase
        .from("infofi_markets")
        .select(
          `
          id,
          season_id,
          player_address,
          player_id,
          market_type,
          contract_address,
          current_probability_bps,
          is_active,
          is_settled,
          settlement_time,
          winning_outcome,
          created_at,
          updated_at
        `,
        )
        .eq("id", marketId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return reply.code(404).send({ error: "Market not found" });
        }
        fastify.log.error({ error }, "Failed to fetch market");
        return reply.code(500).send({
          error: "Failed to fetch market",
          details: error.message,
        });
      }

      // Transform to match frontend expectations
      const market = {
        id: data.id,
        seasonId: data.season_id,
        raffle_id: data.season_id,
        player: data.player_address,
        player_address: data.player_address,
        player_id: data.player_id,
        market_type: data.market_type,
        contract_address: data.contract_address,
        current_probability_bps: data.current_probability_bps,
        current_probability: data.current_probability_bps,
        is_active: data.is_active,
        is_settled: data.is_settled,
        settlement_time: data.settlement_time,
        winning_outcome: data.winning_outcome,
        created_at: data.created_at,
        updated_at: data.updated_at,
      };

      return reply.send({ market });
    } catch (error) {
      fastify.log.error({ error }, "Unexpected error fetching market");
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/markets/:marketId/trades
   * Get recent trades for a market
   *
   * Query params:
   * - limit: Max results (default 50, max 100)
   *
   * Returns: { trades: [...] }
   */
  fastify.get("/markets/:marketId/trades", async (request, reply) => {
    try {
      const { marketId } = request.params;
      const limit = Math.min(parseInt(request.query.limit) || 50, 100);

      const { data, error } = await supabase
        .from("infofi_positions")
        .select("id, market_id, user_address, outcome, amount, price, tx_hash, created_at")
        .eq("market_id", marketId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        fastify.log.error({ error }, "Failed to fetch market trades");
        return reply.code(500).send({
          error: "Failed to fetch market trades",
          details: error.message,
        });
      }

      return reply.send({ trades: data || [] });
    } catch (error) {
      fastify.log.error({ error }, "Unexpected error fetching market trades");
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/markets/:marketId/holders
   * Get top holders for a market grouped by outcome
   *
   * Returns: { yes: [{address, total_amount}], no: [{address, total_amount}] }
   */
  fastify.get("/markets/:marketId/holders", async (request, reply) => {
    try {
      const { marketId } = request.params;

      // Get top YES holders
      const { data: yesData, error: yesError } = await supabase
        .rpc("get_top_holders_by_outcome", {
          p_market_id: parseInt(marketId),
          p_outcome: "YES",
          p_limit: 3,
        });

      // Get top NO holders
      const { data: noData, error: noError } = await supabase
        .rpc("get_top_holders_by_outcome", {
          p_market_id: parseInt(marketId),
          p_outcome: "NO",
          p_limit: 3,
        });

      // If RPC function doesn't exist, fall back to raw queries
      if (yesError || noError) {
        fastify.log.warn("RPC get_top_holders_by_outcome not available, using raw queries");

        const { data: yesRaw, error: yesRawErr } = await supabase
          .from("infofi_positions")
          .select("user_address, amount")
          .eq("market_id", marketId)
          .eq("outcome", "YES");

        const { data: noRaw, error: noRawErr } = await supabase
          .from("infofi_positions")
          .select("user_address, amount")
          .eq("market_id", marketId)
          .eq("outcome", "NO");

        if (yesRawErr || noRawErr) {
          return reply.code(500).send({
            error: "Failed to fetch holders",
            details: (yesRawErr || noRawErr).message,
          });
        }

        // Aggregate in JS
        const aggregate = (positions) => {
          const map = {};
          for (const pos of positions || []) {
            const addr = pos.user_address;
            map[addr] = (map[addr] || 0) + parseFloat(pos.amount || 0);
          }
          return Object.entries(map)
            .map(([address, total_amount]) => ({ address, total_amount }))
            .sort((a, b) => b.total_amount - a.total_amount)
            .slice(0, 3);
        };

        return reply.send({
          yes: aggregate(yesRaw),
          no: aggregate(noRaw),
        });
      }

      return reply.send({
        yes: (yesData || []).map(r => ({ address: r.user_address, total_amount: r.total_amount })),
        no: (noData || []).map(r => ({ address: r.user_address, total_amount: r.total_amount })),
      });
    } catch (error) {
      fastify.log.error({ error }, "Unexpected error fetching market holders");
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/markets/:marketId/info
   * Get market pool info (reserves and volume)
   *
   * Returns all values in WEI (raw 18-decimal BigInt strings) for frontend compatibility.
   * Frontend uses formatUnits(value, 18) to display human-readable amounts.
   *
   * Returns: { totalYesPool, totalNoPool, volume }
   */
  fastify.get("/markets/:marketId/info", async (request, reply) => {
    try {
      const { marketId } = request.params;

      // Get market to find FPMM contract address
      const { data: market, error: marketError } = await supabase
        .from("infofi_markets")
        .select("id, contract_address")
        .eq("id", marketId)
        .single();

      if (marketError || !market) {
        return reply.code(404).send({ error: "Market not found" });
      }

      // If no FPMM contract yet, return zeros
      if (!market.contract_address) {
        return reply.send({
          totalYesPool: "0",
          totalNoPool: "0",
          volume: "0",
        });
      }

      // Read on-chain FPMM reserves
      let totalYesPool = "0";
      let totalNoPool = "0";
      try {
        const simpleFpmmAbi = (await import("../../src/abis/SimpleFPMMAbi.js")).default;
        const [yesReserve, noReserve] = await Promise.all([
          publicClient.readContract({
            address: market.contract_address,
            abi: simpleFpmmAbi,
            functionName: "yesReserve",
          }),
          publicClient.readContract({
            address: market.contract_address,
            abi: simpleFpmmAbi,
            functionName: "noReserve",
          }),
        ]);
        totalYesPool = yesReserve.toString();
        totalNoPool = noReserve.toString();
      } catch (chainError) {
        fastify.log.warn(
          { chainError: chainError.message, address: market.contract_address },
          "Failed to read FPMM reserves from chain"
        );
      }

      // Get volume from positions table (sum of all SOF amounts traded)
      // Amounts are stored as human-readable (e.g. "10" = 10 SOF)
      // Convert to wei for frontend compatibility
      const { data: volumeData, error: volumeError } = await supabase
        .from("infofi_positions")
        .select("amount")
        .eq("market_id", marketId);

      let volumeWei = 0n;
      const WEI = 10n ** 18n;
      if (!volumeError && volumeData) {
        for (const pos of volumeData) {
          try {
            // amount is stored as human-readable string like "10" or "10.5"
            // Convert to wei: parseFloat → multiply by 1e18
            const humanAmount = parseFloat(pos.amount || "0");
            if (humanAmount > 0) {
              // Use integer math to avoid floating point issues
              // Multiply whole part and fractional part separately
              const wholePart = BigInt(Math.floor(humanAmount));
              const fracPart = BigInt(
                Math.round((humanAmount - Math.floor(humanAmount)) * 1e18)
              );
              volumeWei += wholePart * WEI + fracPart;
            }
          } catch {
            // Skip invalid amounts
          }
        }
      }

      return reply.send({
        totalYesPool,
        totalNoPool,
        volume: volumeWei.toString(),
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch market info");
      return reply.code(500).send({
        error: "Failed to fetch market info",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/markets/batch-info?ids=1,2,3
   * Batch fetch market pool info (reserves and volume) for multiple markets
   *
   * Query params:
   * - ids: Comma-separated market IDs (max 50)
   *
   * Returns: { results: { "1": { totalYesPool, totalNoPool, volume }, ... } }
   */
  fastify.get("/markets/batch-info", async (request, reply) => {
    try {
      const { ids } = request.query;
      if (!ids) {
        return reply.code(400).send({ error: "ids query parameter is required" });
      }

      const marketIds = ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50);

      if (marketIds.length === 0) {
        return reply.send({ results: {} });
      }

      // Get all markets with their contract addresses
      const { data: markets, error: marketsError } = await supabase
        .from("infofi_markets")
        .select("id, contract_address")
        .in("id", marketIds.map(Number));

      if (marketsError) {
        fastify.log.error({ error: marketsError }, "Failed to fetch markets for batch-info");
        return reply.code(500).send({
          error: "Failed to fetch markets",
          details: marketsError.message,
        });
      }

      const simpleFpmmAbi = (await import("../../src/abis/SimpleFPMMAbi.js")).default;
      const WEI = 10n ** 18n;
      const results = {};

      // Process all markets in parallel
      await Promise.all(
        (markets || []).map(async (market) => {
          const mid = String(market.id);

          let totalYesPool = "0";
          let totalNoPool = "0";

          // Read on-chain reserves if contract exists
          if (market.contract_address) {
            try {
              const [yesReserve, noReserve] = await Promise.all([
                publicClient.readContract({
                  address: market.contract_address,
                  abi: simpleFpmmAbi,
                  functionName: "yesReserve",
                }),
                publicClient.readContract({
                  address: market.contract_address,
                  abi: simpleFpmmAbi,
                  functionName: "noReserve",
                }),
              ]);
              totalYesPool = yesReserve.toString();
              totalNoPool = noReserve.toString();
            } catch (chainError) {
              fastify.log.warn(
                { chainError: chainError.message, address: market.contract_address },
                "Failed to read FPMM reserves from chain (batch)"
              );
            }
          }

          // Get volume from positions table
          const { data: volumeData, error: volumeError } = await supabase
            .from("infofi_positions")
            .select("amount")
            .eq("market_id", market.id);

          let volumeWei = 0n;
          if (!volumeError && volumeData) {
            for (const pos of volumeData) {
              try {
                const humanAmount = parseFloat(pos.amount || "0");
                if (humanAmount > 0) {
                  const wholePart = BigInt(Math.floor(humanAmount));
                  const fracPart = BigInt(
                    Math.round((humanAmount - Math.floor(humanAmount)) * 1e18)
                  );
                  volumeWei += wholePart * WEI + fracPart;
                }
              } catch {
                // Skip invalid amounts
              }
            }
          }

          results[mid] = {
            totalYesPool,
            totalNoPool,
            volume: volumeWei.toString(),
          };
        })
      );

      return reply.send({ results });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch batch market info");
      return reply.code(500).send({
        error: "Failed to fetch batch market info",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/markets/:marketId/history
   * Get historical odds for a market
   *
   * Query params:
   * - range: Time range (1H, 6H, 1D, 1W, 1M, ALL)
   *
   * Returns: { marketId, seasonId, range, dataPoints, count, downsampled }
   */
  fastify.get("/markets/:marketId/history", async (request, reply) => {
    try {
      const { marketId } = request.params;
      const { range = "ALL" } = request.query;

      if (!historicalOddsRanges.includes(range)) {
        return reply.code(400).send({
          error: `Invalid time range. Supported ranges: ${historicalOddsRanges.join(
            ", ",
          )}`,
        });
      }

      const market = await db.getInfoFiMarketById(marketId);
      if (!market) {
        return reply.code(404).send({ error: "Market not found" });
      }

      const seasonId =
        market.season_id ?? market.raffle_id ?? market.raffleId ?? 0;

      const result = await historicalOddsService.getHistoricalOdds(
        seasonId,
        marketId,
        range,
      );

      return reply.send({
        marketId: String(marketId),
        seasonId: String(seasonId),
        range,
        dataPoints: result.dataPoints,
        count: result.count,
        downsampled: result.downsampled,
      });
    } catch (error) {
      fastify.log.error({ error }, "Error fetching historical odds");
      return reply.code(500).send({
        error: "Failed to fetch historical odds",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/seasons/:seasonId/markets
   * Get all markets for a specific season
   *
   * Returns: { markets: [...], total: number }
   */
  fastify.get("/seasons/:seasonId/markets", async (request, reply) => {
    try {
      const { seasonId } = request.params;
      const { isActive, marketType } = request.query;

      let query = supabase
        .from("infofi_markets")
        .select(
          `
          id,
          season_id,
          player_address,
          player_id,
          market_type,
          contract_address,
          current_probability_bps,
          is_active,
          is_settled,
          settlement_time,
          winning_outcome,
          created_at,
          updated_at
        `,
        )
        .eq("season_id", seasonId)
        .order("created_at", { ascending: false });

      if (isActive !== undefined) {
        query = query.eq("is_active", isActive === "true");
      }

      if (marketType) {
        query = query.eq("market_type", marketType);
      }

      const { data, error } = await query;

      if (error) {
        fastify.log.error({ error }, "Failed to fetch season markets");
        return reply.code(500).send({
          error: "Failed to fetch season markets",
          details: error.message,
        });
      }

      // Transform markets
      const markets = (data || []).map((market) => ({
        id: market.id,
        seasonId: market.season_id,
        raffle_id: market.season_id,
        player: market.player_address,
        player_address: market.player_address,
        player_id: market.player_id,
        market_type: market.market_type,
        contract_address: market.contract_address,
        current_probability_bps: market.current_probability_bps,
        current_probability: market.current_probability_bps,
        is_active: market.is_active,
        is_settled: market.is_settled,
        settlement_time: market.settlement_time,
        winning_outcome: market.winning_outcome,
        created_at: market.created_at,
        updated_at: market.updated_at,
      }));

      return reply.send({
        markets,
        total: markets.length,
        seasonId: Number(seasonId),
      });
    } catch (error) {
      fastify.log.error({ error }, "Unexpected error fetching season markets");
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/stats
   * Get aggregate statistics across all markets
   *
   * Returns: { totalMarkets, activeMarkets, settledMarkets, marketsByType }
   */
  fastify.get("/stats", async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from("infofi_markets")
        .select("id, is_active, is_settled, market_type");

      if (error) {
        fastify.log.error({ error }, "Failed to fetch market stats");
        return reply.code(500).send({
          error: "Failed to fetch market stats",
          details: error.message,
        });
      }

      const stats = {
        totalMarkets: data?.length || 0,
        activeMarkets: data?.filter((m) => m.is_active).length || 0,
        settledMarkets: data?.filter((m) => m.is_settled).length || 0,
        marketsByType: {},
      };

      // Count by market type
      if (data) {
        for (const market of data) {
          const type = market.market_type || "UNKNOWN";
          stats.marketsByType[type] = (stats.marketsByType[type] || 0) + 1;
        }
      }

      return reply.send(stats);
    } catch (error) {
      fastify.log.error({ error }, "Unexpected error fetching stats");
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  fastify.get("/markets/admin-summary", async (_request, reply) => {
    try {
      const { data, error } = await supabase
        .from("infofi_markets")
        .select("season_id, is_active, is_settled, market_type");

      if (error) {
        fastify.log.error({ error }, "Failed to fetch admin markets summary");
        return reply.code(500).send({
          error: "Failed to fetch markets summary",
          details: error.message,
        });
      }

      const seasons = {};

      if (Array.isArray(data)) {
        for (const row of data) {
          const sid = String(row.season_id);
          if (!seasons[sid]) {
            seasons[sid] = {
              seasonId: row.season_id,
              totalMarkets: 0,
              activeMarkets: 0,
              settledMarkets: 0,
              marketsByType: {},
            };
          }

          const season = seasons[sid];
          season.totalMarkets += 1;
          if (row.is_active) season.activeMarkets += 1;
          if (row.is_settled) season.settledMarkets += 1;

          const type = row.market_type || "UNKNOWN";
          season.marketsByType[type] = (season.marketsByType[type] || 0) + 1;
        }
      }

      return reply.send({
        seasons,
        totalSeasons: Object.keys(seasons).length,
        totalMarkets: data?.length || 0,
      });
    } catch (error) {
      fastify.log.error(
        { error },
        "Unexpected error fetching markets admin summary",
      );
      return reply.code(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/positions/:userAddress
   * Get all positions for a user, optionally filtered by market
   *
   * Query params:
   * - marketId: Filter by specific market (optional)
   *
   * Returns: { positions: [...] }
   */
  fastify.get("/positions/:userAddress", async (request, reply) => {
    try {
      const { userAddress } = request.params;
      const { marketId } = request.query;

      const positions = await infoFiPositionService.getUserPositions(
        userAddress,
        marketId ? parseInt(marketId) : null,
      );

      return { positions };
    } catch (error) {
      fastify.log.error({ error }, "Error fetching user positions");
      return reply.code(500).send({
        error: "Failed to fetch positions",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/positions/:userAddress/aggregated
   * Get aggregated positions for a user in a specific market
   *
   * Query params:
   * - marketId: Market ID (required)
   *
   * Returns: { positions: [...] }
   */
  fastify.get("/positions/:userAddress/aggregated", async (request, reply) => {
    try {
      const { userAddress } = request.params;
      const { marketId } = request.query;

      if (!marketId) {
        return reply.code(400).send({
          error: "marketId query parameter is required",
        });
      }

      const positions = await infoFiPositionService.getAggregatedPosition(
        userAddress,
        parseInt(marketId),
      );

      return { positions };
    } catch (error) {
      fastify.log.error({ error }, "Error fetching aggregated positions");
      return reply.code(500).send({
        error: "Failed to fetch aggregated positions",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/positions/:userAddress/net
   * Get net position for a user in a binary market
   *
   * Query params:
   * - marketId: Market ID (required)
   *
   * Returns: { yes, no, net, isHedged, numTradesYes, numTradesNo }
   */
  fastify.get("/positions/:userAddress/net", async (request, reply) => {
    try {
      const { userAddress } = request.params;
      const { marketId } = request.query;

      if (!marketId) {
        return reply.code(400).send({
          error: "marketId query parameter is required",
        });
      }

      const netPosition = await infoFiPositionService.getNetPosition(
        userAddress,
        parseInt(marketId),
      );

      // Convert human-readable amounts to wei for frontend compatibility
      // Frontend uses BigInt() + formatUnits(value, 18)
      const toWei = (humanStr) => {
        const num = parseFloat(humanStr || "0");
        if (num === 0) return "0";
        const wholePart = BigInt(Math.floor(Math.abs(num)));
        const fracPart = BigInt(
          Math.round((Math.abs(num) - Math.floor(Math.abs(num))) * 1e18)
        );
        const wei = wholePart * (10n ** 18n) + fracPart;
        return num < 0 ? (-wei).toString() : wei.toString();
      };

      return {
        yes: toWei(netPosition.yes),
        no: toWei(netPosition.no),
        net: toWei(netPosition.net),
        isHedged: netPosition.isHedged,
        numTradesYes: netPosition.numTradesYes,
        numTradesNo: netPosition.numTradesNo,
      };
    } catch (error) {
      fastify.log.error({ error }, "Error fetching net position");
      return reply.code(500).send({
        error: "Failed to fetch net position",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/positions/:userAddress/batch?marketIds=1,2,3
   * Batch fetch net positions for a user across multiple markets
   *
   * Query params:
   * - marketIds: Comma-separated market IDs (max 50)
   *
   * Returns: { results: { "1": { yes, no, net, isHedged }, ... } }
   */
  fastify.get("/positions/:userAddress/batch", async (request, reply) => {
    try {
      const { userAddress } = request.params;
      const { marketIds } = request.query;

      if (!marketIds) {
        return reply.code(400).send({
          error: "marketIds query parameter is required",
        });
      }

      const ids = marketIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50);

      if (ids.length === 0) {
        return reply.send({ results: {} });
      }

      const toWei = (humanStr) => {
        const num = parseFloat(humanStr || "0");
        if (num === 0) return "0";
        const wholePart = BigInt(Math.floor(Math.abs(num)));
        const fracPart = BigInt(
          Math.round((Math.abs(num) - Math.floor(Math.abs(num))) * 1e18)
        );
        const wei = wholePart * (10n ** 18n) + fracPart;
        return num < 0 ? (-wei).toString() : wei.toString();
      };

      const results = {};

      // Process all markets in parallel
      await Promise.all(
        ids.map(async (marketId) => {
          try {
            const netPosition = await infoFiPositionService.getNetPosition(
              userAddress,
              parseInt(marketId)
            );

            results[marketId] = {
              yes: toWei(netPosition.yes),
              no: toWei(netPosition.no),
              net: toWei(netPosition.net),
              isHedged: netPosition.isHedged,
              numTradesYes: netPosition.numTradesYes,
              numTradesNo: netPosition.numTradesNo,
            };
          } catch (err) {
            fastify.log.warn(
              { marketId, error: err.message },
              "Failed to fetch net position for market (batch)"
            );
            results[marketId] = {
              yes: "0",
              no: "0",
              net: "0",
              isHedged: false,
              numTradesYes: 0,
              numTradesNo: 0,
            };
          }
        })
      );

      return reply.send({ results });
    } catch (error) {
      fastify.log.error({ error }, "Error fetching batch positions");
      return reply.code(500).send({
        error: "Failed to fetch batch positions",
        details: error.message,
      });
    }
  });

  /**
   * POST /api/infofi/markets/:fpmmAddress/sync
   * Sync historical trades for a market from blockchain
   *
   * Query params:
   * - fromBlock: Starting block number (optional)
   *
   * Returns: { success, recorded, skipped, totalEvents, fromBlock, toBlock }
   */
  fastify.post("/markets/:fpmmAddress/sync", async (request, reply) => {
    try {
      const { fpmmAddress } = request.params;
      const { fromBlock } = request.query;

      const result = await infoFiPositionService.syncMarketPositions(
        fpmmAddress,
        fromBlock ? BigInt(fromBlock) : null,
      );

      return result;
    } catch (error) {
      fastify.log.error({ error }, "Error syncing market positions");
      return reply.code(500).send({
        error: "Failed to sync market positions",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/infofi/winnings/:userAddress
   * Get all claimable winnings for a user
   *
   * Query params:
   * - marketId: Filter by specific market (optional)
   * - isClaimed: Filter by claimed status (optional, default: false)
   *
   * Returns: { winnings: [...] }
   */
  fastify.get("/winnings/:userAddress", async (request, reply) => {
    try {
      const { userAddress } = request.params;
      const { marketId, isClaimed } = request.query;

      let query = supabase
        .from("infofi_winnings")
        .select(
          `
          id,
          user_address,
          market_id,
          amount,
          is_claimed,
          claimed_at,
          created_at,
          infofi_markets (
            id,
            season_id,
            player_address,
            market_type,
            contract_address,
            is_settled,
            winning_outcome
          )
        `,
        )
        .eq("user_address", userAddress.toLowerCase());

      // Filter by claimed status (default to unclaimed only)
      if (isClaimed !== undefined) {
        query = query.eq("is_claimed", isClaimed === "true");
      } else {
        query = query.eq("is_claimed", false);
      }

      if (marketId) {
        query = query.eq("market_id", parseInt(marketId));
      }

      const { data, error } = await query.order("created_at", {
        ascending: false,
      });

      if (error) {
        fastify.log.error({ error }, "Failed to fetch winnings");
        return reply.code(500).send({
          error: "Failed to fetch winnings",
          details: error.message,
        });
      }

      // Transform to match frontend expectations
      const winnings = (data || []).map((w) => ({
        id: w.id,
        user_address: w.user_address,
        market_id: w.market_id,
        amount: w.amount,
        is_claimed: w.is_claimed,
        claimed_at: w.claimed_at,
        created_at: w.created_at,
        market: w.infofi_markets
          ? {
              id: w.infofi_markets.id,
              season_id: w.infofi_markets.season_id,
              player_address: w.infofi_markets.player_address,
              market_type: w.infofi_markets.market_type,
              contract_address: w.infofi_markets.contract_address,
              is_settled: w.infofi_markets.is_settled,
              winning_outcome: w.infofi_markets.winning_outcome,
            }
          : null,
      }));

      return reply.send({ winnings });
    } catch (error) {
      fastify.log.error({ error }, "Error fetching winnings");
      return reply.code(500).send({
        error: "Failed to fetch winnings",
        details: error.message,
      });
    }
  });

  /**
   * POST /api/infofi/admin/settle-season
   * Manually settle all InfoFi markets for a completed season
   * Body: { seasonId: number, winnerAddress: string, resolveOnchain?: boolean }
   */
  fastify.post("/admin/settle-season", async (request, reply) => {
    try {
      const {
        seasonId,
        winnerAddress,
        resolveOnchain = true,
      } = request.body || {};

      if (!seasonId || !winnerAddress) {
        return reply.code(400).send({
          error: "seasonId and winnerAddress are required",
        });
      }

      const normalizedWinner = winnerAddress.toLowerCase();
      let onchainResult = null;

      // Step 1: Resolve markets onchain if requested
      if (resolveOnchain) {
        const { getWalletClient, publicClient } =
          await import("../../src/lib/viemClient.js");
        const { getChainByKey } = await import("../../src/config/chain.js");
        const InfoFiMarketFactoryAbi = (
          await import("../../src/abis/InfoFiMarketFactoryAbi.js")
        ).default;

        const network = process.env.DEFAULT_NETWORK || "TESTNET";
        const chain = getChainByKey(network);
        const infoFiFactoryAddress = chain.infofiFactory;
        if (!infoFiFactoryAddress) {
          onchainResult = {
            success: false,
            error: `INFOFI_FACTORY_ADDRESS_${network} not configured`,
          };
        } else {
          try {
            const wallet = getWalletClient(network);

            fastify.log.info(
              `📡 Calling resolveSeasonMarkets(${seasonId}, ${winnerAddress})`,
            );

            const hash = await wallet.writeContract({
              address: infoFiFactoryAddress,
              abi: InfoFiMarketFactoryAbi,
              functionName: "resolveSeasonMarkets",
              args: [BigInt(seasonId), winnerAddress],
            });

            fastify.log.info(`⏳ Transaction submitted: ${hash}`);

            const receipt = await publicClient.waitForTransactionReceipt({
              hash,
              confirmations: 1,
            });

            onchainResult = {
              success: receipt.status === "success",
              hash,
              blockNumber: Number(receipt.blockNumber),
            };

            fastify.log.info(
              `✅ Onchain resolution complete: ${receipt.status}`,
            );
          } catch (onchainError) {
            onchainResult = {
              success: false,
              error: onchainError.message,
              shortMessage: onchainError.shortMessage,
            };
            fastify.log.error(
              { error: onchainError },
              "Onchain resolution failed",
            );
          }
        }
      }

      // Step 2: Update database records
      const { data: markets, error: fetchError } = await supabase
        .from("infofi_markets")
        .select("*")
        .eq("season_id", seasonId);

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      if (!markets || markets.length === 0) {
        return reply.send({
          success: true,
          message: `No InfoFi markets found for season ${seasonId}`,
          settled: 0,
          onchainResult,
        });
      }

      let settled = 0;
      const results = [];

      // Update each market and create winnings entries
      for (const market of markets) {
        const isWinner =
          market.player_address?.toLowerCase() === normalizedWinner;

        const { error: updateError } = await supabase
          .from("infofi_markets")
          .update({
            is_active: false,
            is_settled: true,
            settlement_time: new Date().toISOString(),
            winning_outcome: isWinner,
            updated_at: new Date().toISOString(),
          })
          .eq("id", market.id);

        if (updateError) {
          results.push({
            marketId: market.id,
            player: market.player_address,
            error: updateError.message,
          });
          continue;
        }

        // Step 3: Calculate winnings for users who bet on the winning outcome
        // Get all positions for this market
        const { data: positions, error: posError } = await supabase
          .from("infofi_positions")
          .select("*")
          .eq("market_id", market.id);

        if (posError) {
          fastify.log.error(
            { error: posError, marketId: market.id },
            "Failed to fetch positions for market",
          );
        } else if (positions && positions.length > 0) {
          // Determine winning outcome: YES if player won, NO if player lost
          const winningOutcome = isWinner ? "YES" : "NO";

          // Calculate winnings for each user who bet on the winning outcome
          for (const pos of positions) {
            if (pos.outcome === winningOutcome) {
              // Check if winning already exists
              const { data: existingWinning } = await supabase
                .from("infofi_winnings")
                .select("id")
                .eq("user_address", pos.user_address)
                .eq("market_id", market.id)
                .single();

              if (!existingWinning) {
                // Create winning entry (amount = position amount for now, can be adjusted)
                const { error: winError } = await supabase
                  .from("infofi_winnings")
                  .insert({
                    user_address: pos.user_address,
                    market_id: market.id,
                    amount: pos.amount, // Payout amount
                    is_claimed: false,
                    created_at: new Date().toISOString(),
                  });

                if (winError) {
                  fastify.log.error(
                    { error: winError, position: pos },
                    "Failed to create winning entry",
                  );
                }
              }
            }
          }
        }

        settled++;
        results.push({
          marketId: market.id,
          player: market.player_address,
          isWinner,
          settled: true,
        });
      }

      fastify.log.info(
        { seasonId, winnerAddress, settled, total: markets.length },
        "InfoFi markets settled",
      );

      return reply.send({
        success: true,
        seasonId,
        winnerAddress,
        settled,
        total: markets.length,
        results,
        onchainResult,
      });
    } catch (error) {
      fastify.log.error({ error }, "Error settling InfoFi markets");
      return reply.code(500).send({
        error: "Failed to settle markets",
        details: error.message,
      });
    }
  });
}
