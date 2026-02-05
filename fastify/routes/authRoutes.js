/**
 * Auth Routes — wallet-based SIWE-style authentication
 *
 * GET  /api/auth/nonce?address=0x...  — generate a one-time nonce
 * POST /api/auth/verify               — verify signature, return JWT
 */

import crypto from "node:crypto";
import { verifyMessage } from "viem";
import { redisClient } from "../../shared/redisClient.js";
import { AuthService } from "../../shared/auth.js";
import { getUserAccess, ACCESS_LEVEL_NAMES } from "../../shared/accessService.js";

const NONCE_TTL_SECONDS = 300; // 5 minutes
const SIGN_IN_MESSAGE_PREFIX = "Sign in to SecondOrder.fun\nNonce: ";

/**
 * Build the Redis key used to store a nonce for a given address.
 */
function nonceKey(address) {
  return `auth:nonce:${address.toLowerCase()}`;
}

export default async function authRoutes(fastify) {
  /**
   * GET /nonce?address=0x...
   * Returns { nonce } and stores it in Redis with a 5-minute TTL.
   */
  fastify.get("/nonce", async (request, reply) => {
    const { address } = request.query;

    if (!address || typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "Valid Ethereum address required (?address=0x...)" });
    }

    const nonce = crypto.randomUUID();
    const redis = redisClient.getClient();

    await redis.set(nonceKey(address), nonce, "EX", NONCE_TTL_SECONDS);

    return reply.send({ nonce });
  });

  /**
   * POST /verify
   * Body: { address, signature, nonce }
   * Verifies the wallet signature against the expected message,
   * checks the nonce matches what's stored in Redis,
   * looks up the user's access level, and returns a JWT.
   */
  fastify.post("/verify", async (request, reply) => {
    const { address, signature, nonce } = request.body || {};

    if (!address || !signature || !nonce) {
      return reply.code(400).send({ error: "address, signature, and nonce are required" });
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: "Invalid address format" });
    }

    const redis = redisClient.getClient();
    const key = nonceKey(address);

    // Retrieve and validate the stored nonce
    const storedNonce = await redis.get(key);

    if (!storedNonce) {
      return reply.code(401).send({ error: "Nonce expired or not found. Request a new one." });
    }

    if (storedNonce !== nonce) {
      return reply.code(401).send({ error: "Nonce mismatch" });
    }

    // Verify the signature
    const message = `${SIGN_IN_MESSAGE_PREFIX}${nonce}`;

    let isValid;
    try {
      isValid = await verifyMessage({ address, message, signature });
    } catch (err) {
      fastify.log.error({ err }, "Signature verification error");
      return reply.code(401).send({ error: "Signature verification failed" });
    }

    if (!isValid) {
      return reply.code(401).send({ error: "Invalid signature" });
    }

    // Consume the nonce (one-time use)
    await redis.del(key);

    // Look up the user's access level from the allowlist
    const accessInfo = await getUserAccess({ wallet: address });

    // Build a user payload matching AuthService.generateToken expectations
    const role = ACCESS_LEVEL_NAMES[accessInfo.level] || "user";

    const token = await AuthService.generateToken({
      id: accessInfo.entry?.id || address.toLowerCase(),
      wallet_address: address.toLowerCase(),
      role,
    });

    return reply.send({
      token,
      user: {
        address: address.toLowerCase(),
        accessLevel: accessInfo.level,
        role,
      },
    });
  });
}
