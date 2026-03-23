/**
 * @file paymasterProxyRoutes.js
 * @description Paymaster routes:
 *   POST /coinbase — Proxies ERC-7677 paymaster requests to Coinbase CDP.
 *   POST /         — Backward-compatible alias for POST /coinbase.
 *   POST /session  — Issues a short-lived session token for Pimlico-sponsored txs.
 *   POST /pimlico  — Proxies ERC-7677 paymaster requests to Pimlico (session-gated).
 */

import crypto from "node:crypto";
import { redisClient } from "../../shared/redisClient.js";
import { AuthService } from "../../shared/auth.js";

const CHAIN_IDS = { TESTNET: 84532, MAINNET: 8453 };

const networkKey = (process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK || "LOCAL").toUpperCase();
const isTestnetModule = networkKey === "TESTNET";
const chainId = CHAIN_IDS[networkKey] || CHAIN_IDS.TESTNET;
const pimlicoApiKey = isTestnetModule
  ? process.env.PIMLICO_API_KEY_TESTNET
  : process.env.PIMLICO_API_KEY;
const pimlicoUrl = pimlicoApiKey
  ? `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${pimlicoApiKey}`
  : null;

export default async function paymasterProxyRoutes(fastify) {
  const isTestnet =
    (process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK || "LOCAL") === "TESTNET";

  const paymasterUrl = isTestnet
    ? process.env.PAYMASTER_RPC_URL_TESTNET
    : process.env.PAYMASTER_RPC_URL;

  // ─── Coinbase CDP proxy handler ───────────────────────────────────────────

  const coinbaseHandler = async (request, reply) => {
    if (!paymasterUrl) {
      return reply.status(503).send({
        error: "Coinbase paymaster not configured",
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
  };

  const coinbaseRateLimit = {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
  };

  // ─── POST /coinbase — Coinbase CDP proxy ──────────────────────────────────

  fastify.post("/coinbase", {
    ...coinbaseRateLimit,
    handler: coinbaseHandler,
  });

  // ─── POST / — Backward-compatible alias ───────────────────────────────────

  fastify.post("/", {
    ...coinbaseRateLimit,
    handler: coinbaseHandler,
  });

  // ─── POST /pimlico — Pimlico proxy (session-gated) ───────────────────────

  fastify.post("/pimlico", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      const sessionToken = request.query.session;
      if (!sessionToken) {
        return reply.status(401).send({ error: "Invalid or expired session" });
      }

      const redis = redisClient.getClient();
      const valid = await redis.get(`paymaster:session:${sessionToken}`);
      if (!valid) {
        return reply.status(401).send({ error: "Invalid or expired session" });
      }

      if (!pimlicoUrl) {
        return reply.status(503).send({ error: "Pimlico paymaster not configured" });
      }

      try {
        const response = await fetch(pimlicoUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        });

        const data = await response.json();
        return reply.status(response.status).send(data);
      } catch (err) {
        fastify.log.error({ err }, "Pimlico proxy request failed");
        return reply.status(502).send({ error: "Paymaster request failed" });
      }
    },
  });

  // ─── POST /session — Issue Pimlico session token ─────────────────────────

  fastify.post("/session", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute",
      },
    },
    handler: async (request, reply) => {
      // Explicit auth — do not rely on global preHandler
      let user;
      try {
        user = await AuthService.authenticateRequest(request);
      } catch (err) {
        return reply.status(401).send({ error: "Authentication required" });
      }

      const sessionToken = crypto.randomUUID().replaceAll("-", "");
      const redis = redisClient.getClient();
      await redis.set(`paymaster:session:${sessionToken}`, "1", "EX", 300);

      return reply.send({ sessionToken });
    },
  });
}
