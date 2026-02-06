// Season routes for exposing season_contracts data
import { db } from "../../shared/supabaseClient.js";

export default async function seasonRoutes(fastify) {
  // Get season contract info including created_block
  fastify.get("/:seasonId", async (request, reply) => {
    const { seasonId } = request.params;
    
    try {
      const data = await db.getSeasonContracts(Number(seasonId));
      if (!data) {
        return reply.status(404).send({ error: "Season not found" });
      }
      return data;
    } catch (error) {
      fastify.log.error(error, "Failed to get season contracts");
      return reply.status(500).send({ error: error.message });
    }
  });

  // Get all active seasons
  fastify.get("/", async (request, reply) => {
    try {
      const data = await db.getActiveSeasonContracts();
      return data;
    } catch (error) {
      fastify.log.error(error, "Failed to get active seasons");
      return reply.status(500).send({ error: error.message });
    }
  });
}
