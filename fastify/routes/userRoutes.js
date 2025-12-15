import { db } from "../../shared/supabaseClient.js";
import { usernameService } from "../../shared/usernameService.js";

/**
 * User routes for fetching user-specific data
 */
export async function userRoutes(fastify, options) {
  // options unused; required by Fastify
  if (options) {
    // no-op
  }

  /**
   * GET /api/users
   * Return the canonical user list from Redis (Upstash),
   * using UsernameService as the source of truth.
   * Shape: { players: [{ address, username }], count }
   */
  fastify.get("/", async (_request, reply) => {
    try {
      // Use Redis-backed usernameService as canonical user list
      const allUsernames = await usernameService.getAllUsernames();

      // getAllUsernames already returns [{ address, username }]
      const players = (allUsernames || []).map((entry) => ({
        address: entry.address,
        username: entry.username,
      }));

      return reply.send({
        players,
        count: players.length,
      });
    } catch (error) {
      fastify.log.error(
        { error, stack: error.stack },
        "Unexpected error fetching players from Redis"
      );
      return reply.status(500).send({
        error: "Failed to fetch players",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/users/:address/positions
   * Fetch all InfoFi positions for a user address
   */
  fastify.get("/:address/positions", async (request, reply) => {
    try {
      const { address } = request.params;

      if (!address) {
        return reply.code(400).send({ error: "Address parameter is required" });
      }

      // Validate address format (basic check)
      if (!address.match(/^0x[a-fA-F0-9]{40}$/i)) {
        return reply
          .code(400)
          .send({ error: "Invalid Ethereum address format" });
      }

      fastify.log.info({ address }, "Fetching positions for user");

      // Query positions from infofi_positions table joined with markets
      // Using ACTUAL database schema from migrations
      const { data: positions, error } = await db.client
        .from("infofi_positions")
        .select(
          `
          id,
          market_id,
          user_address,
          outcome,
          amount,
          price,
          created_at,
          infofi_markets!inner (
            id,
            season_id,
            player_address,
            market_type,
            initial_probability_bps,
            current_probability_bps
          )
        `
        )
        .eq("user_address", address.toLowerCase());

      if (error) {
        fastify.log.error(
          { error, address },
          "Failed to fetch positions from database"
        );

        // Return empty array instead of error if schema is not fully migrated yet
        // or if join fails because there are no markets / positions tables
        const msg = error.message || "";
        if (
          msg.includes("does not exist") ||
          msg.includes("infofi_positions") ||
          msg.includes("schema cache")
        ) {
          fastify.log.info(
            { address },
            "No positions/markets table yet, returning empty positions"
          );
          return reply.send({
            positions: [],
            count: 0,
            message: "No prediction markets available yet",
          });
        }

        return reply.status(500).send({
          error: "Failed to fetch positions",
          details: error.message,
        });
      }

      fastify.log.info(
        { count: (positions || []).length, address },
        "Positions fetched successfully"
      );

      // Transform data for frontend consumption
      const transformedPositions = (positions || []).map((pos) => {
        const market = pos.infofi_markets;

        // Convert DECIMAL amount to wei string (multiply by 10^18)
        // Database stores as numeric(38,18)
        const amountDecimal = parseFloat(pos.amount || 0);
        const amountWei = Math.floor(amountDecimal * 1e18).toString();

        return {
          id: pos.id,
          marketId: pos.market_id,
          userAddress: pos.user_address,
          outcome: pos.outcome,
          amount: pos.amount, // Keep original decimal for display
          amountWei, // Add wei representation for BigInt conversion
          price: pos.price,
          createdAt: pos.created_at,
          market: market
            ? {
                id: market.id,
                seasonId: market.season_id, // Use season_id from actual schema
                marketType: market.market_type,
                initialProbabilityBps: market.initial_probability_bps,
                currentProbabilityBps: market.current_probability_bps,
                playerAddress: market.player_address,
              }
            : null,
        };
      });

      return reply.send({
        positions: transformedPositions,
        count: transformedPositions.length,
      });
    } catch (error) {
      fastify.log.error(
        { error, stack: error.stack },
        "Unexpected error fetching positions"
      );
      return reply.status(500).send({
        error: "Failed to fetch positions",
        details: error.message,
      });
    }
  });
}

export default userRoutes;
