/**
 * @file paymasterProxyRoutes.js
 * @description Proxies ERC-7677 paymaster requests to Coinbase CDP.
 *   Avoids exposing CDP API key to the frontend.
 *   Called by useSmartTransactions when wallet supports paymasterService.
 */

export default async function paymasterProxyRoutes(fastify) {
  const isTestnet =
    (process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK || "LOCAL") === "TESTNET";

  const paymasterUrl = isTestnet
    ? process.env.PAYMASTER_RPC_URL_TESTNET
    : process.env.PAYMASTER_RPC_URL;

  fastify.post("/", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      if (!paymasterUrl) {
        return reply.status(503).send({
          error: "Paymaster not configured",
        });
      }

      // Optional: require auth for sponsorship
      // if (!request.user) {
      //   return reply.status(401).send({ error: "Authentication required" });
      // }

      try {
        const response = await fetch(paymasterUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        });

        const data = await response.json();
        return reply.status(response.status).send(data);
      } catch (err) {
        fastify.log.error({ err }, "Paymaster proxy request failed");
        return reply.status(502).send({
          error: "Paymaster request failed",
        });
      }
    },
  });
}
