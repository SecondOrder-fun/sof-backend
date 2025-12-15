import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { getChainByKey } from "../config/chain.js";

/**
 * Process a SeasonCompleted event log
 * @param {object} log - Event log from Viem
 * @param {object} logger - Logger instance
 */
async function processSeasonCompletedLog(log, logger) {
  const { seasonId } = log.args;

  try {
    // Convert seasonId from BigInt to number for database storage
    const seasonIdNum =
      typeof seasonId === "bigint" ? Number(seasonId) : seasonId;

    // Check if season exists in database
    const existing = await db.getSeasonContracts(seasonIdNum);
    if (!existing) {
      logger.warn(
        `Season ${seasonId} not found in database, skipping completion`
      );
      return;
    }

    // Mark season as inactive
    await db.updateSeasonStatus(seasonIdNum, false);

    logger.info(
      `✅ SeasonCompleted Event: Season ${seasonId} marked as inactive`
    );
  } catch (error) {
    logger.error(`❌ Failed to process SeasonCompleted for season ${seasonId}`);
    logger.error(`   Error: ${error.message}`);
    // Continue listening; don't crash on individual failures
  }
}

/**
 * Scan for historical SeasonCompleted events that may have been missed
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 */
async function scanHistoricalSeasonCompletedEvents(
  raffleAddress,
  raffleAbi,
  logger
) {
  try {
    logger.info("🔍 Scanning for historical SeasonCompleted events...");

    // Get current block
    const currentBlock = await publicClient.getBlockNumber();

    // Scan using network-specific lookback blocks
    const chain = getChainByKey(process.env.DEFAULT_NETWORK);
    const lookbackBlocks = chain.lookbackBlocks;
    const fromBlock =
      currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

    logger.info(`   Scanning from block ${fromBlock} to ${currentBlock}`);

    // Fetch historical events
    const logs = await publicClient.getContractEvents({
      address: raffleAddress,
      abi: raffleAbi,
      eventName: "SeasonCompleted",
      fromBlock,
      toBlock: currentBlock,
    });

    if (logs.length > 0) {
      logger.info(
        `   Found ${logs.length} historical SeasonCompleted event(s)`
      );

      for (const log of logs) {
        await processSeasonCompletedLog(log, logger);
      }
    } else {
      logger.info("   No historical SeasonCompleted events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical SeasonCompleted events: ${error.message}`
    );
    // Don't throw - continue with real-time listener
  }
}

/**
 * Starts listening for SeasonCompleted events from the Raffle contract
 * Marks seasons as inactive when they complete
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Fastify logger instance (app.log)
 * @returns {function} Unwatch function to stop listening
 */
export async function startSeasonCompletedListener(
  raffleAddress,
  raffleAbi,
  logger
) {
  // Validate inputs
  if (!raffleAddress || !raffleAbi) {
    throw new Error("raffleAddress and raffleAbi are required");
  }

  if (!logger) {
    throw new Error("logger instance is required");
  }

  // First, scan for any historical events we may have missed
  await scanHistoricalSeasonCompletedEvents(raffleAddress, raffleAbi, logger);

  // Start watching for SeasonCompleted events
  const unwatch = publicClient.watchContractEvent({
    address: raffleAddress,
    abi: raffleAbi,
    eventName: "SeasonCompleted",
    onLogs: async (logs) => {
      for (const log of logs) {
        await processSeasonCompletedLog(log, logger);
      }
    },
    onError: (error) => {
      // Viem errors have specific properties: name, message, code, details, shortMessage
      try {
        const errorDetails = {
          type: error?.name || "Unknown",
          message: error?.message || String(error),
          shortMessage: error?.shortMessage || undefined,
          code: error?.code || undefined,
          details: error?.details || undefined,
          cause: error?.cause?.message || error?.cause || undefined,
          stack: error?.stack || undefined,
        };

        const isFilterNotFound =
          (errorDetails.details &&
            String(errorDetails.details).includes("filter not found")) ||
          (errorDetails.message &&
            String(errorDetails.message).includes("filter not found"));

        if (isFilterNotFound) {
          logger.debug(
            { errorDetails },
            "SeasonCompleted Listener filter not found (silenced)"
          );
        } else {
          logger.error({ errorDetails }, "❌ SeasonCompleted Listener Error");
        }
      } catch (logError) {
        // Fallback if error object can't be serialized
        const isFilterNotFoundFallback =
          String(error).includes("filter not found") ||
          String(logError).includes("filter not found");
        if (isFilterNotFoundFallback) {
          logger.debug(
            `SeasonCompleted Listener filter not found (silenced): ${String(
              error
            )}`
          );
        } else {
          logger.error(`❌ SeasonCompleted Listener Error: ${String(error)}`);
          logger.debug("Raw error:", error);
        }
      }

      // Future: Implement retry logic or alerting
    },
    poll: true, // Use polling for HTTP transport
    pollingInterval: 3000, // Check every 3 seconds
  });

  logger.info(`🎧 Listening for SeasonCompleted events on ${raffleAddress}`);
  return unwatch;
}
