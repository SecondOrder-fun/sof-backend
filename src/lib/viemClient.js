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
    "DEFAULT_NETWORK environment variable not set. Cannot initialize viem clients.",
  );
}

function buildRpcTransport(rpcUrl) {
  return http(rpcUrl);
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
  transport: buildRpcTransport(defaultChain.rpcUrl),
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
    transport: buildRpcTransport(chain.rpcUrl),
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

  const configuredPrivateKey = process.env.BACKEND_WALLET_PRIVATE_KEY;
  const configuredAddress = process.env.BACKEND_WALLET_ADDRESS;

  if (!configuredPrivateKey) {
    throw new Error(
      `Backend wallet private key not configured for ${netKey}. Set BACKEND_WALLET_PRIVATE_KEY in environment.`,
    );
  }

  if (!configuredAddress) {
    throw new Error(
      `Backend wallet address not configured for ${netKey}. Set BACKEND_WALLET_ADDRESS in environment.`,
    );
  }

  const normalizedKey = configuredPrivateKey.startsWith("0x")
    ? configuredPrivateKey
    : `0x${configuredPrivateKey}`;

  const account = privateKeyToAccount(normalizedKey);

  if (
    account.address.toLowerCase() !== String(configuredAddress).toLowerCase()
  ) {
    throw new Error(
      `BACKEND_WALLET_ADDRESS does not match BACKEND_WALLET_PRIVATE_KEY. Expected ${account.address}, got ${configuredAddress}.`,
    );
  }

  const chain = getChainByKey(key);

  const client = createWalletClient({
    account,
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
    transport: buildRpcTransport(chain.rpcUrl),
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
  },
);
