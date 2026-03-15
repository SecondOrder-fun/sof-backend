/**
 * Airdrop Attestation Routes
 *
 * POST /api/airdrop/attestation — generate an EIP-712 FarcasterAttestation signature
 *   for the authenticated user so they can claim their SOF airdrop on-chain.
 */

import process from "node:process";
import { privateKeyToAccount } from "viem/accounts";

// EIP-712 domain and type constants
const DOMAIN_NAME = "SecondOrder.fun SOFAirdrop";
const DOMAIN_VERSION = "1";
const CHAIN_ID = 84532; // Base Sepolia

const EIP712_TYPES = {
  FarcasterAttestation: [
    { name: "wallet", type: "address" },
    { name: "fid", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

// Attestation validity window (1 hour in seconds)
const ATTESTATION_TTL_SECONDS = 3600;

/**
 * Lazily resolve the backend signer account.
 * Deferred so that env vars are guaranteed to be loaded before first use.
 */
let _signerAccount;
function getSignerAccount() {
  if (_signerAccount) return _signerAccount;

  const rawKey =
    process.env.BACKEND_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;

  if (!rawKey) {
    throw new Error(
      "Backend wallet private key not configured. " +
        "Set BACKEND_WALLET_PRIVATE_KEY or PRIVATE_KEY in environment.",
    );
  }

  const normalizedKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
  _signerAccount = privateKeyToAccount(normalizedKey);
  return _signerAccount;
}

/**
 * Register airdrop routes
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function airdropRoutes(fastify) {
  /**
   * POST /api/airdrop/attestation
   *
   * Requires authentication (Bearer JWT with fid and wallet_address).
   * Returns an EIP-712 signature that the user submits on-chain to claim their airdrop.
   */
  fastify.post("/attestation", async (request, reply) => {
    // ── Resolve identity ────────────────────────────────────────────────
    // Priority: JWT user > request body (MiniApp context sends fid + address directly)
    const user = request.user;
    const wallet = user?.wallet_address || request.body?.address;
    const fid = user?.fid || request.body?.fid;

    if (!wallet) {
      return reply.code(400).send({
        error:
          "No wallet address provided. " +
          "Please sign in with a wallet-linked Farcaster account.",
      });
    }

    if (!fid) {
      return reply.code(400).send({
        error:
          "No Farcaster FID provided. " +
          "Please sign in via Farcaster to claim the airdrop.",
      });
    }

    // ── Resolve airdrop contract address ───────────────────────────────
    const verifyingContract = process.env.SOF_AIRDROP_ADDRESS_TESTNET;

    if (!verifyingContract) {
      fastify.log.error(
        "SOF_AIRDROP_ADDRESS_TESTNET env var is not set — cannot produce attestation",
      );
      return reply.code(503).send({
        error: "Airdrop contract not configured. Please try again later.",
      });
    }

    // ── Build EIP-712 message ──────────────────────────────────────────
    const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECONDS);

    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: CHAIN_ID,
      verifyingContract,
    };

    const message = {
      wallet,
      fid: BigInt(fid),
      deadline,
    };

    // ── Sign ───────────────────────────────────────────────────────────
    let signature;
    try {
      const account = getSignerAccount();

      signature = await account.signTypedData({
        domain,
        types: EIP712_TYPES,
        primaryType: "FarcasterAttestation",
        message,
      });
    } catch (err) {
      fastify.log.error({ err }, "EIP-712 signing failed");
      return reply.code(500).send({ error: "Failed to generate attestation signature" });
    }

    // ── Decompose signature into v, r, s ───────────────────────────────
    // viem returns a 65-byte hex string: r (32 bytes) + s (32 bytes) + v (1 byte)
    const r = `0x${signature.slice(2, 66)}`;
    const s = `0x${signature.slice(66, 130)}`;
    const v = parseInt(signature.slice(130, 132), 16);

    return reply.send({
      fid: Number(fid),
      deadline: Number(deadline),
      v,
      r,
      s,
    });
  });
}
