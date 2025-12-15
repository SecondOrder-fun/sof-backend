/**
 * @file tradeListener.js
 * @description Listens to Trade events from SimpleFPMM contracts and updates market sentiment on oracle
 * @date Oct 26, 2025
 *
 * Handles:
 * - Real-time Trade event detection from SimpleFPMM contracts
 * - Market sentiment calculation based on trade volume/direction
 * - Oracle sentiment updates via oracleCallService
 * - Graceful error handling and logging
 */

import { publicClient } from "../lib/viemClient.js";
import { oracleCallService } from "../services/oracleCallService.js";
import { infoFiPositionService } from "../services/infoFiPositionService.js";

/**
 * Starts listening for Trade events from SimpleFPMM contracts
 * Updates market sentiment on oracle when trades occur
 *
 * @param {string[]} fpmmAddresses - Array of SimpleFPMM contract addresses to monitor
 * @param {object} fpmmAbi - SimpleFPMM contract ABI
 * @param {object} logger - Fastify logger instance (app.log)
 * @returns {Promise<function[]>} Array of unwatch functions to stop listening
 */
export async function startTradeListener(fpmmAddresses, fpmmAbi, logger) {
  // Validate inputs
  if (
    !fpmmAddresses ||
    !Array.isArray(fpmmAddresses) ||
    fpmmAddresses.length === 0
  ) {
    throw new Error("fpmmAddresses must be a non-empty array");
  }

  if (!fpmmAbi) {
    throw new Error("fpmmAbi is required");
  }

  if (!logger) {
    throw new Error("logger instance is required");
  }

  const unwatchFunctions = [];

  logger.info(
    `[TRADE_LISTENER] 🎧 Starting Trade listeners for ${fpmmAddresses.length} FPMM contract(s)...`
  );

  // Start listening for Trade events on each FPMM contract
  for (const fpmmAddress of fpmmAddresses) {
    try {
      logger.info(
        `[TRADE_LISTENER] Setting up listener for FPMM: ${fpmmAddress}`
      );

      const unwatch = publicClient.watchContractEvent({
        address: fpmmAddress,
        abi: fpmmAbi,
        eventName: "Trade",
        onLogs: async (logs) => {
          logger.info(
            `[TRADE_LISTENER] 📥 Received ${logs.length} Trade event(s) for FPMM ${fpmmAddress}`
          );

          for (const log of logs) {
            const txHash = log.transactionHash;
            const blockNum = log.blockNumber;

            try {
              // Extract trade data from event
              const { trader, buyYes, amountIn, amountOut } = log.args;

              logger.info(
                `[TRADE_LISTENER] 📊 Processing Trade: Block ${blockNum}, Tx ${txHash}`
              );
              logger.info(
                `[TRADE_LISTENER]    FPMM: ${fpmmAddress}, Trader: ${trader}`
              );
              logger.info(
                `[TRADE_LISTENER]    BuyYes: ${buyYes}, AmountIn: ${amountIn}, AmountOut: ${amountOut}`
              );

              // Calculate sentiment from trade (using buyYes instead of isLong)
              logger.info(
                `[TRADE_LISTENER] Step 1/3: Calculating sentiment...`
              );
              const sentiment = calculateSentiment(amountIn, buyYes, logger);
              logger.info(
                `[TRADE_LISTENER] ✓ Sentiment calculated: ${sentiment} bps`
              );

              // Update oracle with new sentiment
              logger.info(
                `[TRADE_LISTENER] Step 2/3: Updating oracle sentiment...`
              );
              const result = await oracleCallService.updateMarketSentiment(
                fpmmAddress,
                sentiment,
                logger
              );

              if (result.success) {
                logger.info(
                  `[TRADE_LISTENER] ✓ Oracle updated: ${sentiment} bps (${result.hash})`
                );
              } else {
                logger.warn(
                  `[TRADE_LISTENER] ⚠️  Oracle update failed: ${result.error}`
                );
              }

              // Record position to database
              try {
                logger.info(
                  `[TRADE_LISTENER] Step 3/3: Recording position to database...`
                );
                logger.info(`[TRADE_LISTENER]    Calling recordPosition with:`);
                logger.info(
                  `[TRADE_LISTENER]    - fpmmAddress: ${fpmmAddress}`
                );
                logger.info(`[TRADE_LISTENER]    - trader: ${trader}`);
                logger.info(`[TRADE_LISTENER]    - buyYes: ${buyYes}`);
                logger.info(`[TRADE_LISTENER]    - txHash: ${txHash}`);

                const recordResult = await infoFiPositionService.recordPosition(
                  {
                    fpmmAddress,
                    trader,
                    buyYes,
                    amountIn,
                    amountOut,
                    txHash,
                  }
                );

                if (recordResult.alreadyRecorded) {
                  logger.info(
                    `[TRADE_LISTENER] ℹ️  Position already recorded (id: ${recordResult.id})`
                  );
                } else {
                  logger.info(
                    `[TRADE_LISTENER] ✅ SUCCESS: Position recorded (id: ${recordResult.data?.id})`
                  );
                }
              } catch (positionError) {
                logger.error(
                  `[TRADE_LISTENER] ❌ FAILED to record position for tx ${txHash}`
                );
                logger.error(
                  `[TRADE_LISTENER]    Error: ${positionError.message}`
                );
                logger.error(
                  `[TRADE_LISTENER]    Stack: ${positionError.stack}`
                );
                // Don't crash listener - just log and continue
              }
            } catch (tradeError) {
              logger.error(
                `[TRADE_LISTENER] ❌ FATAL ERROR processing Trade event`
              );
              logger.error(
                `[TRADE_LISTENER]    Tx: ${txHash}, Block: ${blockNum}`
              );
              logger.error(`[TRADE_LISTENER]    Error: ${tradeError.message}`);
              logger.error(`[TRADE_LISTENER]    Stack: ${tradeError.stack}`);
            }
          }
        },
        onError: (error) => {
          // Silently ignore "filter not found" errors - they're expected when filters expire
          if (
            error?.code === -32602 &&
            error?.details?.includes("filter not found")
          ) {
            logger.debug(
              `[TRADE_LISTENER] 🔄 Filter expired for ${fpmmAddress}, will be recreated automatically`
            );
            return;
          }

          try {
            const errorDetails = {
              type: error?.name || "Unknown",
              message: error?.message || String(error),
              code: error?.code || undefined,
              details: error?.details || undefined,
            };

            logger.error(
              `[TRADE_LISTENER] ❌ Listener Error for ${fpmmAddress}:`
            );
            logger.error(
              `[TRADE_LISTENER]    ${JSON.stringify(errorDetails, null, 2)}`
            );
          } catch (logError) {
            logger.error(
              `[TRADE_LISTENER] ❌ Listener Error for ${fpmmAddress}: ${String(
                error
              )}`
            );
          }
        },
        poll: true,
        pollingInterval: 4000, // Check every 4 seconds (slightly longer to reduce RPC load)
      });

      unwatchFunctions.push(unwatch);
      logger.info(
        `[TRADE_LISTENER] ✅ Listening for Trade events on ${fpmmAddress}`
      );
    } catch (error) {
      logger.error(
        `[TRADE_LISTENER] ❌ Failed to start listener for ${fpmmAddress}: ${error.message}`
      );
    }
  }

  logger.info(
    `[TRADE_LISTENER] ✅ All ${unwatchFunctions.length} Trade listeners started successfully`
  );
  return unwatchFunctions;
}

/**
 * Calculate market sentiment from trade data
 *
 * @param {bigint|number} collateralAmount - Amount of collateral traded
 * @param {boolean} isLong - Whether this is a long position (true) or short (false)
 * @param {object} logger - Logger instance
 * @returns {number} Sentiment in basis points (0-10000)
 */
function calculateSentiment(collateralAmount, isLong, logger) {
  try {
    // Convert to number if BigInt
    const amount =
      typeof collateralAmount === "bigint"
        ? Number(collateralAmount)
        : collateralAmount;

    // Simple sentiment calculation:
    // - Long positions increase sentiment (bullish)
    // - Short positions decrease sentiment (bearish)
    // - Larger amounts have more impact
    // - Capped at 0-10000 basis points

    // Base sentiment: 5000 (neutral)
    let sentiment = 5000;

    // Adjust based on position direction and size
    // Scale: 1 unit of collateral = 1 basis point change (capped)
    const adjustment = Math.min(Math.max(amount, -5000), 5000);

    if (isLong) {
      // Long positions increase sentiment
      sentiment = Math.min(10000, 5000 + adjustment);
    } else {
      // Short positions decrease sentiment
      sentiment = Math.max(0, 5000 - adjustment);
    }

    logger.debug(
      `   Sentiment calculation: amount=${amount}, isLong=${isLong}, ` +
        `sentiment=${sentiment} bps`
    );

    return sentiment;
  } catch (error) {
    logger.warn(
      `⚠️  Error calculating sentiment: ${error.message}, defaulting to 5000`
    );
    return 5000; // Default to neutral
  }
}

export default startTradeListener;
