// backend/src/config/chain.js
// Env-driven chain configuration for backend services (read-only onchain)

/**
 * Load env with sane defaults. Validates based on DEFAULT_NETWORK.
 * Only validates RPC URL for the network that's actually being used.
 */
export function loadChainEnv() {
  // Helper to get env var with validation (lazy - only validates when accessed)
  const getEnvWithValidation = (key, networkName, isRequired = false) => {
    const value = process.env[key];

    // Only validate if explicitly required
    if (isRequired && !value) {
      throw new Error(
        `Missing required environment variable: ${key} for ${networkName}. ` +
          `Set this in your .env file or Railway environment variables.`
      );
    }

    return value || "";
  };

  const env = {
    LOCAL: {
      id: Number(process.env.LOCAL_CHAIN_ID || 31337),
      name: process.env.LOCAL_CHAIN_NAME || "Local Anvil",
      rpcUrl: process.env.RPC_URL_LOCAL || "http://127.0.0.1:8545",
      raffle: process.env.RAFFLE_ADDRESS_LOCAL || "",
      sof: process.env.SOF_ADDRESS_LOCAL || "",
      curve: process.env.CURVE_ADDRESS_LOCAL || "",
      infofiFactory: process.env.INFOFI_FACTORY_ADDRESS_LOCAL || "",
      // InfoFi on-chain hybrid price oracle (required for SSE transport)
      infofiOracle: process.env.INFOFI_ORACLE_ADDRESS_LOCAL || "",
      // Network-specific configuration
      avgBlockTime: 1, // Anvil produces blocks instantly
      lookbackBlocks: 10000n, // Smaller lookback for local testing
    },
    TESTNET: {
      id: Number(process.env.TESTNET_CHAIN_ID || 84532),
      name: process.env.TESTNET_NAME || "Base Sepolia",
      rpcUrl: getEnvWithValidation("RPC_URL_TESTNET", "TESTNET", false), // Don't validate at load time
      raffle: process.env.RAFFLE_ADDRESS_TESTNET || "",
      sof: process.env.SOF_ADDRESS_TESTNET || "",
      curve: process.env.CURVE_ADDRESS_TESTNET || "",
      infofiFactory: process.env.INFOFI_FACTORY_ADDRESS_TESTNET || "",
      // InfoFi on-chain hybrid price oracle (required for SSE transport)
      infofiOracle: process.env.INFOFI_ORACLE_ADDRESS_TESTNET || "",
      // Network-specific configuration
      avgBlockTime: 2, // Base has ~2 second block time
      lookbackBlocks: 50000n, // Safe lookback under RPC limit (Base Sepolia limit is 100k)
    },
    MAINNET: {
      id: Number(process.env.MAINNET_CHAIN_ID || 8453),
      name: process.env.MAINNET_NAME || "Base",
      rpcUrl: getEnvWithValidation("RPC_URL_MAINNET", "MAINNET", false), // Don't validate at load time
      raffle: process.env.RAFFLE_ADDRESS_MAINNET || "",
      sof: process.env.SOF_ADDRESS_MAINNET || "",
      curve: process.env.CURVE_ADDRESS_MAINNET || "",
      infofiFactory: process.env.INFOFI_FACTORY_ADDRESS_MAINNET || "",
      // InfoFi on-chain hybrid price oracle (required for SSE transport)
      infofiOracle: process.env.INFOFI_ORACLE_ADDRESS_MAINNET || "",
      // Network-specific configuration
      avgBlockTime: 2, // Base has ~2 second block time
      lookbackBlocks: 50000n, // Safe lookback under RPC limit (Base mainnet limit is 100k)
    },
  };

  // Validate only the network we're actually using
  const defaultNet = (
    process.env.DEFAULT_NETWORK ||
    process.env.VITE_DEFAULT_NETWORK ||
    "LOCAL"
  ).toUpperCase();

  // Define required env vars per network
  const REQUIRED_BY_NETWORK = {
    LOCAL: ["RPC_URL_LOCAL"],
    TESTNET: ["RPC_URL_TESTNET"],
    MAINNET: ["RPC_URL_MAINNET"],
  };

  const required = REQUIRED_BY_NETWORK[defaultNet] || [];
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length) {
    // Log warning rather than crash; healthcheck will surface failures
    // eslint-disable-next-line no-console
    console.warn(
      `[chain] Missing required env for ${defaultNet}: ${missing.join(", ")}`
    );
  }

  return env;
}

/**
 * Get a chain config by key (LOCAL/TESTNET) - NO FALLBACKS.
 * Validates RPC URL when accessed.
 * @param {string} key
 */
export function getChainByKey(key) {
  const env = loadChainEnv();

  // Get network from environment - NO FALLBACKS
  const defaultNet =
    process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK;

  if (!defaultNet && !key) {
    throw new Error(
      "DEFAULT_NETWORK environment variable not set and no network key provided. " +
        "Set DEFAULT_NETWORK in your .env file or Railway environment variables."
    );
  }

  const k = (key || defaultNet).toUpperCase();
  const chain = env[k];

  if (!chain) {
    throw new Error(
      `Invalid network: ${k}. Must be LOCAL, TESTNET, or MAINNET.`
    );
  }

  // Validate RPC URL when chain config is accessed (not at module load time)
  if (!chain.rpcUrl && k !== "LOCAL") {
    throw new Error(
      `Missing RPC_URL_${k} environment variable. ` +
        `Set this in your .env file or Railway environment variables.`
    );
  }

  return chain;
}
