/**
 * @file oracleCallService.js
 * @description Centralized service for calling InfoFiPriceOracle contract with retry logic
 * @date Oct 26, 2025
 *
 * Handles:
 * - Real-time oracle updates via walletClient.writeContract()
 * - Exponential backoff retry (max 5 attempts)
 * - Admin alerts on failure cutoff (3 failed retries)
 * - Transaction receipt tracking
 * - Graceful degradation if oracle unavailable
 */

import { getWalletClient, publicClient } from "../lib/viemClient.js";
import InfoFiPriceOracleAbi from "../abis/InfoFiPriceOracleAbi.js";
import { adminAlertService } from "./adminAlertService.js";

/**
 * OracleCallService - Manages all oracle contract interactions
 */
class OracleCallService {
  constructor() {
    // Get network from environment - NO FALLBACKS
    const network =
      process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK;

    if (!network) {
      throw new Error(
        "DEFAULT_NETWORK environment variable not set. Cannot initialize OracleCallService."
      );
    }

    // Select oracle address based on network
    if (network === "TESTNET") {
      this.oracleAddress = process.env.INFOFI_ORACLE_ADDRESS_TESTNET;
    } else if (network === "MAINNET") {
      this.oracleAddress = process.env.INFOFI_ORACLE_ADDRESS_MAINNET;
    } else if (network === "LOCAL") {
      this.oracleAddress = process.env.INFOFI_ORACLE_ADDRESS_LOCAL;
    } else {
      throw new Error(
        `Invalid DEFAULT_NETWORK value: ${network}. Must be LOCAL, TESTNET, or MAINNET.`
      );
    }

    this.maxRetries = parseInt(process.env.ORACLE_MAX_RETRIES || "5", 10);
    this.alertCutoff = parseInt(process.env.ORACLE_ALERT_CUTOFF || "3", 10);
    this.baseDelayMs = 1000;
    this.maxDelayMs = 30000;
  }

  /**
   * Update raffle probability on oracle
   * @param {string} fpmmAddress - SimpleFPMM contract address (market ID)
   * @param {number} raffleProbabilityBps - Raffle probability in basis points (0-10000)
   * @param {object} logger - Fastify logger instance
   * @returns {Promise<{success: boolean, hash?: string, error?: string}>}
   */
  async updateRaffleProbability(fpmmAddress, raffleProbabilityBps, logger) {
    if (
      !fpmmAddress ||
      fpmmAddress === "0x0000000000000000000000000000000000000000"
    ) {
      logger?.error("❌ Invalid FPMM address for updateRaffleProbability");
      return { success: false, error: "Invalid FPMM address" };
    }

    if (raffleProbabilityBps < 0 || raffleProbabilityBps > 10000) {
      logger?.error(
        `❌ Invalid probability ${raffleProbabilityBps} (must be 0-10000)`
      );
      return { success: false, error: "Invalid probability basis points" };
    }

    return this._callOracleWithRetry(
      "updateRaffleProbability",
      [fpmmAddress, BigInt(raffleProbabilityBps)],
      logger
    );
  }

  /**
   * Update market sentiment on oracle
   * @param {string} fpmmAddress - SimpleFPMM contract address (market ID)
   * @param {number} marketSentimentBps - Market sentiment in basis points (0-10000)
   * @param {object} logger - Fastify logger instance
   * @returns {Promise<{success: boolean, hash?: string, error?: string}>}
   */
  async updateMarketSentiment(fpmmAddress, marketSentimentBps, logger) {
    if (
      !fpmmAddress ||
      fpmmAddress === "0x0000000000000000000000000000000000000000"
    ) {
      logger?.error("❌ Invalid FPMM address for updateMarketSentiment");
      return { success: false, error: "Invalid FPMM address" };
    }

    if (marketSentimentBps < 0 || marketSentimentBps > 10000) {
      logger?.error(
        `❌ Invalid sentiment ${marketSentimentBps} (must be 0-10000)`
      );
      return { success: false, error: "Invalid sentiment basis points" };
    }

    return this._callOracleWithRetry(
      "updateMarketSentiment",
      [fpmmAddress, BigInt(marketSentimentBps)],
      logger
    );
  }

  /**
   * Get current price data from oracle
   * @param {string} fpmmAddress - SimpleFPMM contract address
   * @param {object} logger - Fastify logger instance
   * @returns {Promise<{raffleProbabilityBps, marketSentimentBps, hybridPriceBps, lastUpdate, active}>}
   */
  async getPrice(fpmmAddress, logger) {
    try {
      if (!this.oracleAddress) {
        logger?.warn("⚠️  Oracle address not configured, skipping price read");
        return null;
      }

      const priceData = await publicClient.readContract({
        address: this.oracleAddress,
        abi: InfoFiPriceOracleAbi,
        functionName: "getPrice",
        args: [fpmmAddress],
      });

      return {
        raffleProbabilityBps: Number(priceData[0]),
        marketSentimentBps: Number(priceData[1]),
        hybridPriceBps: Number(priceData[2]),
        lastUpdate: Number(priceData[3]),
        active: priceData[4],
      };
    } catch (error) {
      logger?.error(`❌ Failed to read price from oracle: ${error.message}`);
      return null;
    }
  }

  /**
   * Internal method: Call oracle with exponential backoff retry
   * @private
   * @param {string} functionName - Oracle function to call
   * @param {Array} args - Function arguments
   * @param {object} logger - Fastify logger instance
   * @returns {Promise<{success: boolean, hash?: string, error?: string, attempts: number}>}
   */
  async _callOracleWithRetry(functionName, args, logger) {
    if (!this.oracleAddress) {
      logger?.warn("⚠️  Oracle address not configured, skipping oracle call");
      return {
        success: false,
        error: "Oracle address not configured",
        attempts: 0,
      };
    }

    // Get network from environment - NO FALLBACKS
    const network =
      process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK;

    if (!network) {
      logger?.error(
        "❌ DEFAULT_NETWORK not set - cannot determine which network to use"
      );
      return {
        success: false,
        error: "DEFAULT_NETWORK environment variable not set",
        attempts: 0,
      };
    }

    const wallet = getWalletClient(network);
    if (!wallet) {
      logger?.error("❌ Wallet client not initialized, cannot call oracle");
      return {
        success: false,
        error: "Wallet client not initialized",
        attempts: 0,
      };
    }

    // Log wallet account for verification - ALWAYS FRESH
    const accountAddress = wallet.account.address;
    const expectedAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const isCorrect =
      accountAddress.toLowerCase() === expectedAddress.toLowerCase();

    logger?.info(`📝 Oracle call using account: ${accountAddress}`);
    if (!isCorrect) {
      logger?.error(
        `❌ WRONG ACCOUNT! Expected ${expectedAddress}, got ${accountAddress}`
      );
      logger?.error(
        `❌ PRIVATE_KEY env var: ${
          process.env.BACKEND_WALLET_PRIVATE_KEY ? "SET" : "NOT SET"
        }`
      );
      logger?.error(
        `❌ PRIVATE_KEY env var: ${process.env.PRIVATE_KEY ? "SET" : "NOT SET"}`
      );
    }

    let lastError = null;
    let delayMs = this.baseDelayMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger?.info(
          `📡 Oracle call attempt ${attempt}/${this.maxRetries}: ${functionName}(${args[0]}, ${args[1]})`
        );

        const hash = await wallet.writeContract({
          address: this.oracleAddress,
          abi: InfoFiPriceOracleAbi,
          functionName,
          args,
        });

        logger?.info(
          `✅ Oracle call succeeded: ${functionName} (hash: ${hash})`
        );

        // Record success and reset failure count
        adminAlertService.recordSuccess(args[0], logger);

        // Wait for receipt (optional, but good for confirmation)
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });
          logger?.info(
            `✅ Transaction confirmed: ${hash} (block: ${receipt.blockNumber})`
          );
        } catch (receiptError) {
          logger?.warn(
            `⚠️  Could not confirm transaction receipt: ${receiptError.message}`
          );
        }

        return { success: true, hash, attempts: attempt };
      } catch (error) {
        lastError = error;
        logger?.warn(
          `⚠️  Oracle call failed (attempt ${attempt}/${this.maxRetries}): ${error.message}`
        );

        // Check if we should alert admin
        if (attempt === this.alertCutoff) {
          logger?.error(
            `🚨 ALERT: Oracle call failed ${this.alertCutoff} times. Will continue retrying but admin should be notified.`
          );
          // Record failure and potentially send alert
          adminAlertService.recordFailure(
            args[0],
            functionName,
            error,
            attempt,
            logger
          );
        }

        // Don't retry on last attempt
        if (attempt < this.maxRetries) {
          logger?.info(`⏳ Waiting ${delayMs}ms before retry...`);
          await this._sleep(delayMs);

          // Exponential backoff: double delay, capped at maxDelayMs
          delayMs = Math.min(delayMs * 2, this.maxDelayMs);
        }
      }
    }

    // All retries exhausted
    logger?.error(
      `❌ Oracle call failed after ${this.maxRetries} attempts: ${lastError?.message}`
    );
    return {
      success: false,
      error: lastError?.message || "Unknown error",
      attempts: this.maxRetries,
    };
  }

  /**
   * Sleep utility for retry delays
   * @private
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const oracleCallService = new OracleCallService();

export default oracleCallService;
