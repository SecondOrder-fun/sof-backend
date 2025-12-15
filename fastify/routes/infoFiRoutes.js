// backend/fastify/routes/infoFiRoutes.js
import { supabase } from "../../shared/supabaseClient.js";
import { infoFiPositionService } from "../../src/services/infoFiPositionService.js";

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
        `
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
        `
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
        `
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
        "Unexpected error fetching markets admin summary"
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
        marketId ? parseInt(marketId) : null
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
        parseInt(marketId)
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
        parseInt(marketId)
      );

      return netPosition;
    } catch (error) {
      fastify.log.error({ error }, "Error fetching net position");
      return reply.code(500).send({
        error: "Failed to fetch net position",
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
        fromBlock ? BigInt(fromBlock) : null
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
}
