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
import { startContractEventPolling } from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";
import { db } from "../../shared/supabaseClient.js";
import { historicalOddsService } from "../../shared/historicalOddsService.js";

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
    `[TRADE_LISTENER] 🎧 Starting Trade listeners for ${fpmmAddresses.length} FPMM contract(s)...`,
  );

  // Start listening for Trade events on each FPMM contract
  for (const fpmmAddress of fpmmAddresses) {
    try {
      logger.info(
        `[TRADE_LISTENER] Setting up listener for FPMM: ${fpmmAddress}`,
      );

      // Create persistent block cursor for this FPMM listener
      const blockCursor = await createBlockCursor(`${fpmmAddress}:Trade`);

      const unwatch = await startContractEventPolling({
        client: publicClient,
        address: fpmmAddress,
        abi: fpmmAbi,
        eventName: "Trade",
        pollingIntervalMs: 4_000,
        maxBlockRange: 2_000n,
        blockCursor,
        onLogs: async (logs) => {
          logger.info(
            `[TRADE_LISTENER] 📥 Received ${logs.length} Trade event(s) for FPMM ${fpmmAddress}`,
          );

          for (const log of logs) {
            const txHash = log.transactionHash;
            const blockNum = log.blockNumber;

            try {
              // Extract trade data from event
              const { trader, buyYes, amountIn, amountOut } = log.args;

              logger.info(
                `[TRADE_LISTENER] 📊 Processing Trade: Block ${blockNum}, Tx ${txHash}`,
              );
              logger.info(
                `[TRADE_LISTENER]    FPMM: ${fpmmAddress}, Trader: ${trader}`,
              );
              logger.info(
                `[TRADE_LISTENER]    BuyYes: ${buyYes}, AmountIn: ${amountIn}, AmountOut: ${amountOut}`,
              );

              // Read on-chain FPMM prices to get actual market sentiment
              logger.info(
                `[TRADE_LISTENER] Step 1/3: Reading FPMM prices on-chain...`,
              );
              const sentiment = await readMarketSentiment(
                fpmmAddress,
                fpmmAbi,
                logger,
              );
              logger.info(
                `[TRADE_LISTENER] ✓ Market sentiment (yesPrice): ${sentiment} bps`,
              );

              // Step 2/3: Update DB probability FIRST (fast, reliable)
              try {
                const dbUpdate = await db.updateMarketProbabilityByFpmm(
                  fpmmAddress,
                  sentiment,
                );
                if (dbUpdate) {
                  logger.info(
                    `[TRADE_LISTENER] ✓ DB probability updated: ${sentiment} bps (market ${dbUpdate.id})`,
                  );

                  // Record odds history data point for charts
                  try {
                    const seasonId = dbUpdate.season_id ?? dbUpdate.raffle_id ?? 0;
                    await historicalOddsService.recordOddsUpdate(seasonId, dbUpdate.id, {
                      timestamp: Date.now(),
                      yes_bps: sentiment,
                      no_bps: 10000 - sentiment,
                      hybrid_bps: sentiment,
                      raffle_bps: 0,
                      sentiment_bps: 0,
                    });
                    logger.info(
                      `[TRADE_LISTENER] ✓ Odds history recorded: ${sentiment} bps (market ${dbUpdate.id})`,
                    );
                  } catch (oddsError) {
                    logger.warn(
                      `[TRADE_LISTENER] ⚠️  Failed to record odds history: ${oddsError.message}`,
                    );
                  }
                } else {
                  logger.warn(
                    `[TRADE_LISTENER] ⚠️  DB probability update returned null for ${fpmmAddress}`,
                  );
                }
              } catch (dbError) {
                logger.error(
                  `[TRADE_LISTENER] ❌ Failed to update DB probability: ${dbError.message}`,
                );
              }

              // Step 3/3: Update on-chain oracle (may retry with backoff)
              // Runs AFTER DB update so API stays responsive
              logger.info(
                `[TRADE_LISTENER] Step 3/3: Updating oracle sentiment...`,
              );
              const result = await oracleCallService.updateMarketSentiment(
                fpmmAddress,
                sentiment,
                logger,
              );

              if (result.success) {
                logger.info(
                  `[TRADE_LISTENER] ✓ Oracle updated: ${sentiment} bps (${result.hash})`,
                );
              } else {
                logger.warn(
                  `[TRADE_LISTENER] ⚠️  Oracle update failed: ${result.error}`,
                );
              }

              // Record position to database
              try {
                logger.info(
                  `[TRADE_LISTENER] Step 3/3: Recording position to database...`,
                );
                logger.info(`[TRADE_LISTENER]    Calling recordPosition with:`);
                logger.info(
                  `[TRADE_LISTENER]    - fpmmAddress: ${fpmmAddress}`,
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
                  },
                );

                if (recordResult.alreadyRecorded) {
                  logger.info(
                    `[TRADE_LISTENER] ℹ️  Position already recorded (id: ${recordResult.id})`,
                  );
                } else {
                  logger.info(
                    `[TRADE_LISTENER] ✅ SUCCESS: Position recorded (id: ${recordResult.data?.id})`,
                  );
                }
              } catch (positionError) {
                logger.error(
                  `[TRADE_LISTENER] ❌ FAILED to record position for tx ${txHash}`,
                );
                logger.error(
                  `[TRADE_LISTENER]    Error: ${positionError.message}`,
                );
                logger.error(
                  `[TRADE_LISTENER]    Stack: ${positionError.stack}`,
                );
                // Don't crash listener - just log and continue
              }
            } catch (tradeError) {
              logger.error(
                `[TRADE_LISTENER] ❌ FATAL ERROR processing Trade event`,
              );
              logger.error(
                `[TRADE_LISTENER]    Tx: ${txHash}, Block: ${blockNum}`,
              );
              logger.error(`[TRADE_LISTENER]    Error: ${tradeError.message}`);
              logger.error(`[TRADE_LISTENER]    Stack: ${tradeError.stack}`);
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

            logger.error(
              `[TRADE_LISTENER] ❌ Listener Error for ${fpmmAddress}:`,
            );
            logger.error(
              `[TRADE_LISTENER]    ${JSON.stringify(errorDetails, null, 2)}`,
            );
          } catch (logError) {
            logger.error(
              `[TRADE_LISTENER] ❌ Listener Error for ${fpmmAddress}: ${String(
                logError,
              )}`,
            );
          }
        },
      });

      unwatchFunctions.push(unwatch);
      logger.info(
        `[TRADE_LISTENER] ✅ Listening for Trade events on ${fpmmAddress}`,
      );
    } catch (error) {
      logger.error(
        `[TRADE_LISTENER] ❌ Failed to start listener for ${fpmmAddress}: ${error.message}`,
      );
    }
  }

  logger.info(
    `[TRADE_LISTENER] ✅ All ${unwatchFunctions.length} Trade listeners started successfully`,
  );
  return unwatchFunctions;
}

/**
 * Read market sentiment from on-chain FPMM prices
 *
 * Calls SimpleFPMM.getPrices() which returns (yesPrice, noPrice) in basis points.
 * The yesPrice IS the market sentiment — it represents the market's current
 * probability estimate for YES in bps (0-10000).
 *
 * @param {string} fpmmAddress - SimpleFPMM contract address
 * @param {object} fpmmAbi - SimpleFPMM contract ABI
 * @param {object} logger - Logger instance
 * @returns {Promise<number>} Sentiment in basis points (0-10000)
 */
async function readMarketSentiment(fpmmAddress, fpmmAbi, logger) {
  try {
    const [yesPrice, noPrice] = await publicClient.readContract({
      address: fpmmAddress,
      abi: fpmmAbi,
      functionName: "getPrices",
    });

    const yesPriceBps = Number(yesPrice);
    const noPriceBps = Number(noPrice);

    logger.info(
      `[TRADE_LISTENER]    FPMM prices: yesPrice=${yesPriceBps} bps, noPrice=${noPriceBps} bps`,
    );

    // Sanity check: prices should sum to ~10000 bps
    const sum = yesPriceBps + noPriceBps;
    if (sum < 9900 || sum > 10100) {
      logger.warn(
        `[TRADE_LISTENER] ⚠️  Price sum ${sum} deviates from expected 10000 bps`,
      );
    }

    // yesPrice is already the market sentiment in bps
    // Clamp to valid range just in case
    const sentimentBps = Math.max(0, Math.min(10000, yesPriceBps));
    return sentimentBps;
  } catch (error) {
    logger.error(
      `[TRADE_LISTENER] ❌ Failed to read FPMM prices for ${fpmmAddress}: ${error.message}`,
    );
    // Fallback: return 5000 (neutral) so oracle call still proceeds
    // The oracle will still get an update, just not perfectly accurate
    logger.warn(
      `[TRADE_LISTENER] ⚠️  Falling back to neutral sentiment (5000 bps)`,
    );
    return 5000;
  }
}

export default startTradeListener;
