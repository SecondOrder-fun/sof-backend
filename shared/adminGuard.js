import { getUserAccess, ACCESS_LEVELS } from "./accessService.js";

/**
 * Create a Fastify preHandler that enforces ADMIN access level.
 *
 * @returns {(request: any, reply: any) => Promise<void>} Fastify preHandler
 */
export function createRequireAdmin() {
  return async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const accessInfo = await getUserAccess({
      fid: request.user.fid,
      wallet: request.user.wallet_address,
    });

    if (accessInfo.level < ACCESS_LEVELS.ADMIN) {
      return reply.code(403).send({ error: "Forbidden" });
    }
  };
}
