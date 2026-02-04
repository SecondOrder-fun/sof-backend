import { publicClient, getWalletClient } from "../lib/viemClient.js";
import { db, supabase } from "../../shared/supabaseClient.js";
import { getChainByKey } from "../config/chain.js";
import InfoFiMarketFactoryAbi from "../abis/InfoFiMarketFactoryAbi.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";

/**
 * Resolve InfoFi markets onchain via InfoFiMarketFactory.resolveSeasonMarkets()
 * @param {number} seasonId - Season ID
 * @param {string} winnerAddress - Winner's address
 * @param {object} logger - Logger instance
 * @returns {boolean} - Whether the onchain resolution succeeded
 */
async function resolveMarketsOnchain(seasonId, winnerAddress, logger) {
  try {
    const network = process.env.DEFAULT_NETWORK || "TESTNET";
    const chain = getChainByKey(network);
    const infoFiFactoryAddress = chain.infofiFactory;
    if (!infoFiFactoryAddress) {
      logger.warn(
        `   INFOFI_FACTORY_ADDRESS_${network} not configured, skipping onchain resolution`,
      );
      return false;
    }
    const wallet = getWalletClient(network);

    if (!wallet) {
      logger.error(`   Wallet client not available for onchain resolution`);
      return false;
    }

    logger.info(
      `   📡 Calling resolveSeasonMarkets(${seasonId}, ${winnerAddress}) on ${infoFiFactoryAddress}`,
    );

    const hash = await wallet.writeContract({
      address: infoFiFactoryAddress,
      abi: InfoFiMarketFactoryAbi,
      functionName: "resolveSeasonMarkets",
      args: [BigInt(seasonId), winnerAddress],
    });

    logger.info(`   ⏳ Transaction submitted: ${hash}`);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status === "success") {
      logger.info(
        `   ✅ Onchain market resolution successful (block: ${receipt.blockNumber})`,
      );
      return true;
    } else {
      logger.error(`   ❌ Onchain market resolution failed (reverted)`);
      return false;
    }
  } catch (error) {
    logger.error(`   ❌ Failed to resolve markets onchain: ${error.message}`);
    // Log more details for debugging
    if (error.shortMessage) {
      logger.error(`   Short message: ${error.shortMessage}`);
    }
    return false;
  }
}

/**
 * Settle InfoFi markets for a completed season (both onchain and database)
 * @param {number} seasonId - Season ID
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 */
async function settleInfoFiMarkets(seasonId, raffleAddress, raffleAbi, logger) {
  try {
    // Get winners from the raffle contract
    const winners = await publicClient.readContract({
      address: raffleAddress,
      abi: raffleAbi,
      functionName: "getWinners",
      args: [BigInt(seasonId)],
    });

    if (!winners || winners.length === 0) {
      logger.warn(
        `   No winners found for season ${seasonId}, skipping InfoFi settlement`,
      );
      return;
    }

    const winnerAddress = winners[0]; // First winner is the grand prize winner
    logger.info(`   Season ${seasonId} winner: ${winnerAddress}`);

    // Step 1: Resolve markets onchain first
    const onchainSuccess = await resolveMarketsOnchain(
      seasonId,
      winnerAddress,
      logger,
    );

    if (!onchainSuccess) {
      logger.warn(
        `   Onchain resolution failed, but continuing with database update`,
      );
    }

    // Step 2: Update database records
    const markets = await db.getInfoFiMarketsBySeasonId(seasonId);
    if (!markets || markets.length === 0) {
      logger.info(
        `   No InfoFi markets found in database for season ${seasonId}`,
      );
      return;
    }

    logger.info(
      `   Found ${markets.length} InfoFi market(s) to settle in database`,
    );

    // Update each market in the database
    for (const market of markets) {
      const isWinner =
        market.player_address?.toLowerCase() === winnerAddress.toLowerCase();

      const { error } = await supabase
        .from("infofi_markets")
        .update({
          is_active: false,
          is_settled: true,
          settlement_time: new Date().toISOString(),
          winning_outcome: isWinner,
          updated_at: new Date().toISOString(),
        })
        .eq("id", market.id);

      if (error) {
        logger.error(
          `   Failed to settle market ${market.id} in DB: ${error.message}`,
        );
      } else {
        logger.info(
          `   ✅ DB settled market ${market.id} (player: ${market.player_address}, won: ${isWinner})`,
        );
      }
    }

    logger.info(`   InfoFi markets settlement complete for season ${seasonId}`);
  } catch (error) {
    logger.error(
      `   Failed to settle InfoFi markets for season ${seasonId}: ${error.message}`,
    );
  }
}

/**
 * Process a SeasonCompleted event log
 * @param {object} log - Event log from Viem
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Logger instance
 * @param {function} [onSeasonCompleted] - Callback when season completes (for listener cleanup)
 */
async function processSeasonCompletedLog(
  log,
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCompleted,
) {
  const { seasonId } = log.args;

  try {
    // Convert seasonId from BigInt to number for database storage
    const seasonIdNum =
      typeof seasonId === "bigint" ? Number(seasonId) : seasonId;

    // Check if season exists in database
    const existing = await db.getSeasonContracts(seasonIdNum);
    if (!existing) {
      logger.warn(
        `Season ${seasonId} not found in database, skipping completion`,
      );
      return;
    }

    // Mark season as inactive
    await db.updateSeasonStatus(seasonIdNum, false);

    logger.info(
      `✅ SeasonCompleted Event: Season ${seasonId} marked as inactive`,
    );

    // Settle InfoFi markets for this season
    await settleInfoFiMarkets(seasonIdNum, raffleAddress, raffleAbi, logger);

    // Notify server to clean up per-season listeners
    if (typeof onSeasonCompleted === "function") {
      try {
        await onSeasonCompleted({ seasonId: seasonIdNum });
      } catch (cleanupError) {
        logger.error(
          `❌ Failed to run onSeasonCompleted cleanup for season ${seasonIdNum}: ${cleanupError.message}`,
        );
      }
    }
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
  logger,
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

    // Fetch historical events (chunked + retry/backoff for public RPC stability)
    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: raffleAddress,
      abi: raffleAbi,
      eventName: "SeasonCompleted",
      fromBlock,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(
        `   Found ${logs.length} historical SeasonCompleted event(s)`,
      );

      for (const log of logs) {
        await processSeasonCompletedLog(log, raffleAddress, raffleAbi, logger);
      }
    } else {
      logger.info("   No historical SeasonCompleted events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical SeasonCompleted events: ${error.message}`,
    );
    // Don't throw - continue with real-time listener
  }
}

/**
 * Starts listening for SeasonCompleted events from the Raffle contract
 * Marks seasons as inactive when they complete and settles InfoFi markets
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle contract ABI
 * @param {object} logger - Fastify logger instance (app.log)
 * @param {function} [onSeasonCompleted] - Callback when season completes (for listener cleanup)
 * @returns {function} Unwatch function to stop listening
 */
export async function startSeasonCompletedListener(
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonCompleted,
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

  // Create persistent block cursor for this listener
  const blockCursor = await createBlockCursor(
    `${raffleAddress}:SeasonCompleted`,
  );

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: raffleAddress,
    abi: raffleAbi,
    eventName: "SeasonCompleted",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        await processSeasonCompletedLog(
          log,
          raffleAddress,
          raffleAbi,
          logger,
          onSeasonCompleted,
        );
      }
    },
    onError: (error) => {
      try {
        const errorDetails = {
          type:
            error && typeof error === "object" && "name" in error
              ? String(error.name)
              : "Unknown",
          message:
            error && typeof error === "object" && "message" in error
              ? String(error.message)
              : String(error),
        };
        logger.error({ errorDetails }, "❌ SeasonCompleted Listener Error");
      } catch (logError) {
        logger.error(`❌ SeasonCompleted Listener Error: ${String(logError)}`);
      }
    },
  });

  logger.info(`🎧 Listening for SeasonCompleted events on ${raffleAddress}`);
  return unwatch;
}
