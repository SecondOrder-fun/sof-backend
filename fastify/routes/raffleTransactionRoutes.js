import { raffleTransactionService } from "../../src/services/raffleTransactionService.js";

/**
 * Raffle transaction history API routes
 * Provides endpoints for querying user transaction history and positions
 */
export default async function raffleTransactionRoutes(fastify) {
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
