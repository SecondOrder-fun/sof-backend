/**
 * @file paymasterService.js
 * @description Service for submitting gasless transactions via Base Paymaster
 * Uses viem wallet client for backend operations with Paymaster RPC
 * @author SecondOrder.fun
 */

import { createWalletClient, http, encodeFunctionData } from "viem";
import { baseSepolia, base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { publicClient } from "../lib/viemClient.js";

/**
 * PaymasterService - Handles gasless transaction submission via Base Paymaster
 * @class
 */
export class PaymasterService {
  constructor(logger) {
    this.logger = logger;
    this.walletClient = null;
    this.account = null;
    this.initialized = false;
  }

  /**
   * Initialize the Paymaster service with viem wallet client
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If initialization fails
   */
  async initialize() {
    try {
      const {
        DEFAULT_NETWORK,
        PAYMASTER_RPC_URL_TESTNET,
        BACKEND_WALLET_PRIVATE_KEY,
      } = process.env;

      const isTestnet = DEFAULT_NETWORK === "TESTNET";

      // Validate required environment variables
      if (!PAYMASTER_RPC_URL_TESTNET && isTestnet) {
        throw new Error("PAYMASTER_RPC_URL_TESTNET not configured");
      }

      if (!BACKEND_WALLET_PRIVATE_KEY) {
        throw new Error("BACKEND_WALLET_PRIVATE_KEY not configured");
      }

      // Create account from private key
      const normalizedKey = BACKEND_WALLET_PRIVATE_KEY.startsWith("0x")
        ? BACKEND_WALLET_PRIVATE_KEY
        : `0x${BACKEND_WALLET_PRIVATE_KEY}`;

      this.account = privateKeyToAccount(normalizedKey);

      // Create wallet client with Paymaster RPC
      const chain = isTestnet ? baseSepolia : base;
      const rpcUrl = PAYMASTER_RPC_URL_TESTNET; // Paymaster RPC will sponsor transactions

      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(rpcUrl),
      });

      this.initialized = true;

      this.logger.info(
        `✅ PaymasterService initialized with viem wallet client`
      );
      this.logger.info(
        `   Network: ${isTestnet ? "Base Sepolia" : "Base Mainnet"}`
      );
      this.logger.info(`   Account: ${this.account.address}`);
    } catch (error) {
      this.logger.error(
        `❌ PaymasterService initialization failed: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Create a market via gasless transaction using viem wallet client
   * @async
   * @param {Object} params - Market creation parameters
   * @param {number} params.seasonId - Season identifier
   * @param {string} params.player - Player address
   * @param {number} params.oldTickets - Previous ticket count
   * @param {number} params.newTickets - New ticket count
   * @param {number} params.totalTickets - Total tickets in season
   * @param {string} params.infoFiFactoryAddress - InfoFi factory contract address
   * @param {Object} logger - Logger instance
   * @returns {Promise<Object>} Transaction result with hash and status
   * @throws {Error} If transaction fails after retries
   */
  async createMarket(params, logger) {
    if (!this.initialized) {
      throw new Error(
        "PaymasterService not initialized. Call initialize() first."
      );
    }

    const {
      seasonId,
      player,
      oldTickets,
      newTickets,
      totalTickets,
      infoFiFactoryAddress,
    } = params;

    const maxRetries = 3;
    const retryDelays = [5000, 15000, 45000]; // 5s, 15s, 45s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `🔄 Attempt ${attempt}/${maxRetries}: Creating market for player ${player}`
        );

        // Encode the onPositionUpdate function call
        const data = encodeFunctionData({
          abi: [
            {
              name: "onPositionUpdate",
              type: "function",
              stateMutability: "nonpayable",
              inputs: [
                { name: "seasonId", type: "uint256" },
                { name: "player", type: "address" },
                { name: "oldTickets", type: "uint256" },
                { name: "newTickets", type: "uint256" },
                { name: "totalTickets", type: "uint256" },
              ],
              outputs: [],
            },
          ],
          functionName: "onPositionUpdate",
          args: [
            BigInt(seasonId),
            player,
            BigInt(oldTickets),
            BigInt(newTickets),
            BigInt(totalTickets),
          ],
        });

        // Send transaction - Paymaster RPC will sponsor if contract is in allowlist
        const hash = await this.walletClient.sendTransaction({
          to: infoFiFactoryAddress,
          data,
          value: 0n,
          gas: 5000000n, // Increased gas limit for market creation (FPMM deployment needs ~3M gas)
        });

        logger.info(`✅ Market creation transaction submitted: ${hash}`);

        // Wait for transaction confirmation (don't block the listener)
        publicClient
          .waitForTransactionReceipt({ hash, timeout: 60000 })
          .then((receipt) => {
            if (receipt.status === "success") {
              logger.info(`✅ Market creation confirmed: ${hash}`);
              logger.info(`   Block: ${receipt.blockNumber}`);
              logger.info(`   Gas used: ${receipt.gasUsed}`);
            } else {
              logger.error(`❌ Market creation transaction reverted: ${hash}`);
            }
          })
          .catch((error) => {
            logger.error(
              `❌ Failed to wait for market creation receipt: ${error.message}`
            );
          });

        return {
          success: true,
          hash,
          attempts: attempt,
        };
      } catch (error) {
        logger.error(`❌ Attempt ${attempt} failed: ${error.message}`);

        try {
          logger.error({
            msg: "Full error object from sendTransaction",
            error,
          });
        } catch (serializationError) {
          logger.error(
            `Failed to serialize full error object: ${String(
              serializationError
            )}`
          );
        }

        if (error && error.cause) {
          try {
            logger.error({
              msg: "Nested error.cause",
              cause: error.cause,
            });
          } catch (causeSerializationError) {
            logger.error(
              `Failed to serialize error.cause: ${String(
                causeSerializationError
              )}`
            );
          }
        }

        if (attempt < maxRetries) {
          const delayMs = retryDelays[attempt - 1];
          logger.info(`⏳ Retrying in ${delayMs / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          logger.error(
            `❌ Market creation failed after ${maxRetries} attempts`
          );
          return {
            success: false,
            error: error.message,
            attempts: attempt,
          };
        }
      }
    }
  }

  /**
   * Get the backend wallet address
   * @returns {string} Wallet address
   */
  getWalletAddress() {
    if (!this.initialized) {
      throw new Error("PaymasterService not initialized");
    }
    return this.account.address;
  }
}

// Export singleton instance
let paymasterServiceInstance = null;

/**
 * Get or create PaymasterService singleton
 * @param {Object} logger - Logger instance
 * @returns {PaymasterService} PaymasterService instance
 */
export function getPaymasterService(logger) {
  if (!paymasterServiceInstance) {
    paymasterServiceInstance = new PaymasterService(logger);
  }
  return paymasterServiceInstance;
}
