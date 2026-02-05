import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import SOFBondingCurveAbi from "../abis/SOFBondingCurveAbi.js";
import { startContractEventPolling } from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { historicalOddsService } from "../../shared/historicalOddsService.js";

// Market type hash mapping (matches contract constants)
// These are keccak256 hashes of the market type strings
const MARKET_TYPE_HASHES = {
  "0x9af7ac054212f2f6f51aadd6392aae69c37a65182710ccc31fc2ce8679842eab":
    "WINNER_PREDICTION",
  // Add more market types here as they're added to the contract
};

/**
 * Calculate player's current win probability from Bonding Curve
 * @param {number} seasonId - Season ID
 * @param {string} playerAddress - Player's Ethereum address
 * @param {object} logger - Logger instance
 * @returns {Promise<number>} - Probability in basis points (0-10000)
 */
async function calculateProbability(seasonId, playerAddress, logger) {
  try {
    // Step 1: Get bonding curve address for this season from database
    const seasonContracts = await db.getSeasonContracts(seasonId);

    if (!seasonContracts || !seasonContracts.bonding_curve_address) {
      logger.warn(`⚠️  No bonding curve found for season ${seasonId}`);
      return 0;
    }

    const bondingCurveAddress = seasonContracts.bonding_curve_address;

    // Step 2: Read player's ticket count from bonding curve
    const playerTickets = await publicClient.readContract({
      address: bondingCurveAddress,
      abi: SOFBondingCurveAbi,
      functionName: "playerTickets",
      args: [playerAddress],
    });

    // Step 3: Read total supply from bonding curve config
    const curveConfig = await publicClient.readContract({
      address: bondingCurveAddress,
      abi: SOFBondingCurveAbi,
      functionName: "curveConfig",
      args: [],
    });

    // Handle both array and object return formats
    // Viem can return structs as arrays [totalSupply, sofReserves, ...] or objects {totalSupply, sofReserves, ...}
    const totalSupply = Array.isArray(curveConfig)
      ? curveConfig[0]
      : curveConfig.totalSupply;

    // Step 4: Calculate probability in basis points
    if (totalSupply === 0n) {
      logger.warn(`⚠️  Total supply is 0 for season ${seasonId}`);
      return 0;
    }

    // Convert BigInt to Number safely
    const ticketCount =
      typeof playerTickets === "bigint" ? Number(playerTickets) : playerTickets;
    const totalTickets =
      typeof totalSupply === "bigint" ? Number(totalSupply) : totalSupply;

    // Validate numbers
    if (isNaN(ticketCount) || isNaN(totalTickets)) {
      logger.error(
        `❌ Invalid numbers: ticketCount=${ticketCount}, totalTickets=${totalTickets}`,
      );
      return 0;
    }

    if (totalTickets === 0) {
      logger.warn(
        `⚠️  Total tickets is 0 after conversion for season ${seasonId}`,
      );
      return 0;
    }

    const probabilityBps = Math.floor((ticketCount / totalTickets) * 10000);

    logger.debug(
      `📊 Probability calculated for season ${seasonId}, player ${playerAddress}`,
    );
    logger.debug(`   Player tickets: ${ticketCount}`);
    logger.debug(`   Total tickets: ${totalTickets}`);
    logger.debug(
      `   Probability: ${probabilityBps} bps (${(probabilityBps / 100).toFixed(
        2,
      )}%)`,
    );

    return probabilityBps;
  } catch (error) {
    logger.error(
      `❌ Failed to calculate probability for season ${seasonId}, player ${playerAddress}`,
    );
    logger.error(`   Error: ${error.message}`);
    logger.debug(`   Full error:`, error);

    // Return 0 as fallback (will be updated by positionUpdateListener)
    return 0;
  }
}

/**
 * Starts listening for MarketCreated events from InfoFiMarketFactory
 * Creates complete market entries in database with all required fields
 *
 * @param {string} infoFiFactoryAddress - InfoFiMarketFactory contract address
 * @param {object} infoFiFactoryAbi - InfoFiMarketFactory contract ABI
 * @param {object} logger - Fastify logger instance (app.log)
 * @returns {function} Unwatch function to stop listening
 */
export async function startMarketCreatedListener(
  infoFiFactoryAddress,
  infoFiFactoryAbi,
  logger,
) {
  // Validate inputs
  if (!infoFiFactoryAddress || !infoFiFactoryAbi) {
    throw new Error("infoFiFactoryAddress and infoFiFactoryAbi are required");
  }

  if (!logger) {
    throw new Error("logger instance is required");
  }

  // Create persistent block cursor for this listener
  const blockCursor = await createBlockCursor(
    `${infoFiFactoryAddress}:MarketCreated`,
  );

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: infoFiFactoryAddress,
    abi: infoFiFactoryAbi,
    eventName: "MarketCreated",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        // Log the ENTIRE raw log object first
        logger.info(`🔍 RAW LOG OBJECT:`);
        logger.info(`   Address: ${log.address}`);
        logger.info(`   Topics: ${JSON.stringify(log.topics)}`);
        logger.info(`   Data: ${log.data}`);
        logger.info(
          `   Args (raw): ${JSON.stringify(log.args, (key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          )}`,
        );

        const { seasonId, player, marketType, conditionId, fpmmAddress } =
          log.args;

        try {
          // Convert BigInt values to strings/numbers for logging
          const seasonIdNum =
            typeof seasonId === "bigint" ? Number(seasonId) : seasonId;

          // Debug: Log raw value
          logger.info(`🔍 Raw marketType hash: ${marketType}`);

          // Decode marketType hash to string using mapping
          // Contract emits keccak256(marketType) for gas efficiency
          const marketTypeStr = MARKET_TYPE_HASHES[marketType] || "UNKNOWN";

          if (marketTypeStr === "UNKNOWN") {
            logger.warn(`⚠️  Unknown marketType hash: ${marketType}`);
            logger.warn(`⚠️  Add this hash to MARKET_TYPE_HASHES mapping`);
          } else {
            logger.info(`✅ Decoded marketType: ${marketTypeStr}`);
          }

          // Log market creation with verbose details
          logger.info(`✅ MarketCreated Event: Season ${seasonIdNum}`);
          logger.info(`   Player: ${player}`);
          logger.info(`   Market Type: ${marketTypeStr}`);
          logger.info(`   FPMM Address: ${fpmmAddress}`);
          logger.info(`   Condition ID: ${conditionId}`);
          logger.info(`   Transaction Hash: ${log.transactionHash}`);
          logger.info(`   Block Number: ${log.blockNumber}`);

          // Create complete market entry in database
          try {
            // Check if market already exists (prevent duplicates from case sensitivity)
            const existingMarket = await db.hasInfoFiMarket(
              seasonIdNum,
              player,
              marketTypeStr,
            );
            if (existingMarket) {
              logger.warn(
                `⚠️  Market already exists for season ${seasonIdNum}, player ${player}, type ${marketTypeStr}`,
              );
              logger.warn(`   Skipping duplicate market creation`);
              continue; // Skip to next log
            }

            // Get or create player_id
            let playerId;
            try {
              playerId = await db.getOrCreatePlayerId(player);
              logger.info(`   Player ID retrieved: ${playerId}`);
            } catch (playerError) {
              logger.error(
                `   Failed to get/create player ID: ${playerError.message}`,
              );
              logger.debug(`   Player error details:`, playerError);
              playerId = null; // Explicitly set to null if failed
            }

            // Calculate current probability
            const probabilityBps = await calculateProbability(
              seasonIdNum,
              player,
              logger,
            );

            // Create market entry with all required fields
            const timestamp = new Date().toISOString();
            const createdMarket = await db.createInfoFiMarket({
              season_id: seasonIdNum,
              player_address: player,
              player_id: playerId,
              market_type: marketTypeStr,
              contract_address: fpmmAddress,
              current_probability_bps: probabilityBps,
              is_active: true,
              is_settled: false,
              created_at: timestamp,
              updated_at: timestamp,
            });

            logger.info(`✅ InfoFi market created in database`);
            logger.info(`   Player ID: ${playerId}`);
            logger.info(`   Market Type: ${marketTypeStr}`);
            logger.info(
              `   Probability: ${probabilityBps} bps (${(
                probabilityBps / 100
              ).toFixed(2)}%)`,
            );
            logger.info(`   Status: Market created successfully`);

            // Record initial odds as the first historical data point
            // This is the "Market Start" point on the odds graph
            if (createdMarket?.id) {
              try {
                await historicalOddsService.recordOddsUpdate(seasonIdNum, createdMarket.id, {
                  timestamp: Date.now(),
                  yes_bps: probabilityBps,
                  no_bps: 10000 - probabilityBps,
                  hybrid_bps: probabilityBps,
                  raffle_bps: 0,
                  sentiment_bps: 0,
                });
                logger.info(
                  `[MARKET_CREATED] ✓ Initial odds recorded: ${probabilityBps} bps (market ${createdMarket.id})`,
                );
              } catch (oddsError) {
                logger.warn(
                  `[MARKET_CREATED] ⚠️  Failed to record initial odds: ${oddsError.message}`,
                );
              }
            }
          } catch (dbError) {
            logger.error(
              `❌ Failed to create market in database: ${dbError.message}`,
            );
            logger.debug(`   Full error:`, dbError);
            // Don't throw - continue listening even if database update fails
          }
        } catch (error) {
          logger.error(
            `❌ Failed to process MarketCreated event for season ${seasonId}, player ${player}`,
          );
          logger.error(`   Error Type: ${error?.name || "Unknown"}`);
          logger.error(`   Error Message: ${error?.message || String(error)}`);
          logger.debug(`   Full Error:`, error);
          // Continue listening; don't crash on individual failures
        }
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
        logger.error({ errorDetails }, "❌ MarketCreated Listener Error");
      } catch (logError) {
        logger.error(`❌ MarketCreated Listener Error: ${String(logError)}`);
      }
    },
  });

  logger.info(
    `🎧 Listening for MarketCreated events on ${infoFiFactoryAddress}`,
  );
  return unwatch;
}
