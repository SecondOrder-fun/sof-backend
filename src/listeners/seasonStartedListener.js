import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { getChainByKey } from "../config/chain.js";

/**
 * Process a SeasonStarted event log
 * @param {object} log - Event log from Viem
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 * @param {function} onSeasonCreated - Callback for new season
 */
async function processSeasonStartedLog(
  log,
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCreated
) {
  const { seasonId } = log.args;

  try {
    // Check if season already exists in database
    const existing = await db.getSeasonContracts(Number(seasonId));
    if (existing) {
      logger.debug(`Season ${seasonId} already exists in database, skipping`);
      return;
    }

    // 1. Retrieve season details from contract
    const result = await publicClient.readContract({
      address: raffleAddress,
      abi: raffleAbi,
      functionName: "getSeasonDetails",
      args: [seasonId],
    });

    // Viem returns tuple: [config, status, totalParticipants, totalTickets, totalPrizePool]
    // config is a struct with NAMED properties (not array indices)
    const config = result[0];

    // Extract addresses using named properties
    const { raffleToken, bondingCurve } = config;

    // 2. Store in database
    // Convert seasonId from BigInt to number for database storage
    const seasonIdNum =
      typeof seasonId === "bigint" ? Number(seasonId) : seasonId;

    await db.createSeasonContracts({
      season_id: seasonIdNum,
      bonding_curve_address: bondingCurve,
      raffle_token_address: raffleToken,
      raffle_address: raffleAddress,
      is_active: true,
    });

    // 3. Log success
    logger.info(`✅ SeasonStarted Event: Season ${seasonId} has started`);
    logger.info(`   BondingCurve: ${bondingCurve}`);
    logger.info(`   RaffleToken: ${raffleToken}`);

    // 4. Dynamically start PositionUpdate listener for this season
    if (typeof onSeasonCreated === "function") {
      try {
        await onSeasonCreated({
          seasonId: seasonIdNum,
          bondingCurveAddress: bondingCurve,
          raffleTokenAddress: raffleToken,
        });
      } catch (listenerError) {
        logger.error(
          `❌ Failed to start PositionUpdate listener for season ${seasonIdNum}`
        );
        logger.error(`   Error: ${listenerError.message}`);
      }
    }
  } catch (error) {
    logger.error(`❌ Failed to process SeasonStarted for season ${seasonId}`);
    logger.error(`   Error: ${error.message}`);
    // Continue listening; don't crash on individual failures
  }
}

/**
 * Scan for historical SeasonStarted events that may have been missed
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 * @param {function} onSeasonCreated - Callback for new season
 */
async function scanHistoricalSeasonEvents(
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCreated
) {
  try {
    logger.info("🔍 Scanning for historical SeasonStarted events...");

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
      eventName: "SeasonStarted",
      fromBlock,
      toBlock: currentBlock,
    });

    if (logs.length > 0) {
      logger.info(`   Found ${logs.length} historical SeasonStarted event(s)`);

      for (const log of logs) {
        await processSeasonStartedLog(
          log,
          raffleAddress,
          raffleAbi,
          logger,
          onSeasonCreated
        );
      }
    } else {
      logger.info("   No historical events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical SeasonStarted events: ${error.message}`
    );
    // Don't throw - continue with real-time listener
  }
}

/**
 * Starts listening for SeasonStarted events from the Raffle contract
 * Retrieves season contract addresses and stores them in the database
 * Dynamically starts PositionUpdate listeners for new seasons
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Fastify logger instance (app.log)
 * @param {function} onSeasonCreated - Callback to start PositionUpdate listener for new season
 * @returns {function} Unwatch function to stop listening
 */
export async function startSeasonStartedListener(
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCreated
) {
  // Validate inputs
  if (!raffleAddress || !raffleAbi) {
    throw new Error("raffleAddress and raffleAbi are required");
  }

  if (!logger) {
    throw new Error("logger instance is required");
  }

  // First, scan for any historical events we may have missed
  await scanHistoricalSeasonEvents(
    raffleAddress,
    raffleAbi,
    logger,
    onSeasonCreated
  );

  // Start watching for SeasonStarted events
  const unwatch = publicClient.watchContractEvent({
    address: raffleAddress,
    abi: raffleAbi,
    eventName: "SeasonStarted",
    onLogs: async (logs) => {
      for (const log of logs) {
        await processSeasonStartedLog(
          log,
          raffleAddress,
          raffleAbi,
          logger,
          onSeasonCreated
        );
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
            "SeasonStarted Listener filter not found (silenced)"
          );
        } else {
          logger.error({ errorDetails }, "❌ SeasonStarted Listener Error");
        }
      } catch (logError) {
        // Fallback if error object can't be serialized
        const isFilterNotFoundFallback =
          String(error).includes("filter not found") ||
          String(logError).includes("filter not found");
        if (isFilterNotFoundFallback) {
          logger.debug(
            `SeasonStarted Listener filter not found (silenced): ${String(
              error
            )}`
          );
        } else {
          logger.error(`❌ SeasonStarted Listener Error: ${String(error)}`);
          logger.debug("Raw error:", error);
        }
      }

      // Future: Implement retry logic or alerting
    },
    poll: true, // Use polling for HTTP transport
    pollingInterval: 3000, // Check every 3 seconds
  });

  logger.info(`🎧 Listening for SeasonStarted events on ${raffleAddress}`);
  return unwatch;
}
