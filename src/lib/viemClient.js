// backend/src/lib/viemClient.js
// Factory for viem PublicClient and WalletClient per network

import process from "node:process";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChainByKey } from "../config/chain.js";

// Select network from environment - NO FALLBACKS
const NETWORK =
  process.env.NETWORK ||
  process.env.DEFAULT_NETWORK ||
  process.env.VITE_DEFAULT_NETWORK;

if (!NETWORK) {
  throw new Error(
    "DEFAULT_NETWORK environment variable not set. Cannot initialize viem clients."
  );
}

// Default public client for event listeners (uses configured NETWORK)
const defaultChain = getChainByKey(NETWORK);
export const publicClient = createPublicClient({
  chain: {
    id: defaultChain.id,
    name: defaultChain.name,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [defaultChain.rpcUrl] } },
  },
  transport: http(defaultChain.rpcUrl),
  pollingInterval: 4_000, // Force polling mode for public RPC compatibility
});

/**
 * Build a viem PublicClient for a given network key (LOCAL/TESTNET).
 * @param {string} [key]
 */
export function getPublicClient(key) {
  const chain = getChainByKey(key);
  return createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
    transport: http(chain.rpcUrl),
    pollingInterval: 4_000, // Force polling mode for public RPC compatibility
  });
}

/**
 * Build a viem WalletClient for backend wallet operations.
 * Lazy-loads on first use to ensure .env is fully loaded.
 * IMPORTANT: Does NOT cache - always reads fresh private key from .env
 * @param {string} [key] - Network key (LOCAL/TESTNET). Defaults to NETWORK.
 * @returns {import('viem').WalletClient}
 */
export function getWalletClient(key = NETWORK) {
  const netKey = String(key || "").toUpperCase();

  // IMPORTANT:
  // - For TESTNET/MAINNET we require explicit network-specific private keys.
  // - For LOCAL we allow the generic keys.
  // Reason: prevents accidentally using a local/mainnet key on a different network.
  let privateKey;

  if (netKey === "TESTNET") {
    privateKey = process.env.PRIVATE_KEY_TESTNET;
    if (!privateKey) {
      throw new Error(
        "Backend wallet private key not configured for TESTNET. Set PRIVATE_KEY_TESTNET in environment."
      );
    }
  } else if (netKey === "MAINNET") {
    privateKey = process.env.PRIVATE_KEY_MAINNET;
    if (!privateKey) {
      throw new Error(
        "Backend wallet private key not configured for MAINNET. Set PRIVATE_KEY_MAINNET in environment."
      );
    }
  } else {
    privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error(
        "Backend wallet private key not configured for LOCAL. Set PRIVATE_KEY in environment."
      );
    }
  }

  const chain = getChainByKey(key);
  const account = privateKeyToAccount(privateKey);

  const client = createWalletClient({
    account,
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
    transport: http(chain.rpcUrl),
  });

  return client;
}

/**
 * Default wallet client for backend operations (uses configured NETWORK).
 * Lazy-loaded via Proxy to ensure .env is loaded before first use.
 * Use this for simple backend operations. Use getWalletClient(key) for network switching.
 */
export const walletClient = new Proxy(
  {},
  {
    get: (target, prop) => {
      const client = getWalletClient(NETWORK);
      return client[prop];
    },
  }
);
