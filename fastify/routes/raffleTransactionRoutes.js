import { raffleTransactionService } from "../../src/services/raffleTransactionService.js";

/**
 * Raffle transaction history API routes
 * Provides endpoints for querying user transaction history and positions
 */
export default async function raffleTransactionRoutes(fastify) {
  // Get all transactions for a season (paginated)
  fastify.get(
    "/transactions/season/:seasonId",
    async (request, reply) => {
      const { seasonId } = request.params;
      const { limit, offset, order } = request.query;

      try {
        const result = await raffleTransactionService.getSeasonTransactions(
          parseInt(seasonId),
          {
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
            order,
          }
        );

        return result;
      } catch (error) {
        fastify.log.error("Failed to fetch season transactions:", error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get user's transaction history for a season
  fastify.get(
    "/transactions/:userAddress/:seasonId",
    async (request, reply) => {
      const { userAddress, seasonId } = request.params;
      const { limit, offset, orderBy, order } = request.query;

      try {
        const transactions = await raffleTransactionService.getUserTransactions(
          userAddress,
          parseInt(seasonId),
          { limit, offset, orderBy, order }
        );

        return { transactions };
      } catch (error) {
        fastify.log.error("Failed to fetch transactions:", error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get user's aggregated position for a season
  fastify.get("/positions/:userAddress/:seasonId", async (request, reply) => {
    const { userAddress, seasonId } = request.params;

    try {
      const position = await raffleTransactionService.getUserPosition(
        userAddress,
        parseInt(seasonId)
      );

      return { position };
    } catch (error) {
      fastify.log.error("Failed to fetch position:", error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Get user's positions across all seasons
  fastify.get("/positions/:userAddress", async (request, reply) => {
    const { userAddress } = request.params;

    try {
      const positions = await raffleTransactionService.getAllUserPositions(
        userAddress
      );

      return { positions };
    } catch (error) {
      fastify.log.error("Failed to fetch all positions:", error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Admin: Check partition status and create missing partitions
  fastify.get("/admin/diagnostics", async (request, reply) => {
    try {
      const { db } = await import("../../shared/supabaseClient.js");

      // Check if table exists
      const { data: tableCheck, error: tableError } = await db.client
        .from("raffle_transactions")
        .select("id", { count: "exact", head: true });

      // Check which partitions exist
      let partitions = null;
      let partError = null;
      try {
        const result = await db.client.rpc("get_partition_info");
        partitions = result.data;
        partError = result.error;
      } catch {
        partError = { message: "RPC function not available" };
      }

      // Get active seasons
      const { data: seasons } = await db.client
        .from("season_contracts")
        .select("season_id")
        .eq("is_active", true);

      // Try creating partitions for active seasons
      const partitionResults = [];
      for (const s of seasons || []) {
        try {
          const { error } = await db.client.rpc("create_raffle_tx_partition", {
            season_num: s.season_id,
          });
          partitionResults.push({
            seasonId: s.season_id,
            success: !error,
            error: error?.message || null,
          });
        } catch (err) {
          partitionResults.push({
            seasonId: s.season_id,
            success: false,
            error: err.message,
          });
        }
      }

      return {
        tableExists: !tableError,
        tableError: tableError?.message || null,
        rowCount: tableCheck?.length ?? 0,
        partitionRpcAvailable: !partError,
        partitionError: partError?.message || null,
        partitions: partitions || "unavailable",
        activeSeasons: seasons?.map((s) => s.season_id) || [],
        partitionCreation: partitionResults,
      };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Admin: Sync transactions for a season
  fastify.post("/admin/sync/:seasonId", async (request, reply) => {
    const { seasonId } = request.params;
    const { bondingCurveAddress } = request.body;

    if (!bondingCurveAddress) {
      return reply.code(400).send({ error: "bondingCurveAddress is required" });
    }

    try {
      const result = await raffleTransactionService.syncSeasonTransactions(
        parseInt(seasonId),
        bondingCurveAddress
      );

      return result;
    } catch (error) {
      fastify.log.error("Failed to sync transactions:", error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Admin: Refresh materialized view
  fastify.post("/admin/refresh-positions", async (request, reply) => {
    const { seasonId } = request.body;

    try {
      await raffleTransactionService.refreshUserPositions(seasonId || null);
      return { success: true, message: "Positions refreshed" };
    } catch (error) {
      fastify.log.error("Failed to refresh positions:", error);
      return reply.code(500).send({ error: error.message });
    }
  });
}
