import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { getChainByKey } from "../config/chain.js";
import { oracleCallService } from "../services/oracleCallService.js";
import { getPaymasterService } from "../services/paymasterService.js";
import { getSSEService } from "../services/sseService.js";
import { raffleTransactionService } from "../services/raffleTransactionService.js";
import {
  getContractEventsInChunks,
  startContractEventPolling,
} from "../lib/contractEventPolling.js";
import { createBlockCursor } from "../lib/blockCursor.js";

/**
 * Scan for historical PositionUpdate events that may have been missed
 * (e.g., if the listener was restarted after token purchases occurred)
 */
async function scanHistoricalPositionUpdateEvents(
  bondingCurveAddress,
  bondingCurveAbi,
  raffleAddress,
  raffleAbi,
  infoFiFactoryAddress,
  maxSupply,
  paymasterService,
  sseService,
  logger,
) {
  try {
    logger.info(
      `🔍 Scanning for historical PositionUpdate events on ${bondingCurveAddress}...`,
    );

    const currentBlock = await publicClient.getBlockNumber();
    const chain = getChainByKey(process.env.DEFAULT_NETWORK);
    const lookbackBlocks = chain.lookbackBlocks;
    const fromBlock =
      currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;

    logger.info(`   Scanning from block ${fromBlock} to ${currentBlock}`);

    const logs = await getContractEventsInChunks({
      client: publicClient,
      address: bondingCurveAddress,
      abi: bondingCurveAbi,
      eventName: "PositionUpdate",
      fromBlock,
      toBlock: currentBlock,
      maxBlockRange: 2_000n,
      maxRetries: 5,
    });

    if (logs.length > 0) {
      logger.info(
        `   Found ${logs.length} historical PositionUpdate event(s)`,
      );

      // Collect unique players who have crossed the 1% threshold to check for missing markets
      const supplyForThreshold =
        maxSupply && maxSupply > 0 ? maxSupply : undefined;

      // Process each log to find players who crossed threshold but may not have markets
      for (const log of logs) {
        const { seasonId, player, oldTickets, newTickets, totalTickets } =
          log.args;

        const seasonIdNum =
          typeof seasonId === "bigint" ? Number(seasonId) : seasonId;
        const oldTicketsNum =
          typeof oldTickets === "bigint" ? Number(oldTickets) : oldTickets;
        const newTicketsNum =
          typeof newTickets === "bigint" ? Number(newTickets) : newTickets;
        const totalTicketsNum =
          typeof totalTickets === "bigint" ? Number(totalTickets) : totalTickets;

        const denominator = supplyForThreshold || totalTicketsNum;
        const oldShareBps =
          oldTicketsNum > 0
            ? Math.round((oldTicketsNum * 10000) / denominator)
            : 0;
        const newShareBps = Math.round((newTicketsNum * 10000) / denominator);
        const thresholdBps = 100; // 1%

        // Check if this event represents a threshold crossing
        if (oldShareBps < thresholdBps && newShareBps >= thresholdBps) {
          // Check if market already exists for this player
          try {
            const existingFpmm = await db.getFpmmAddress(
              seasonIdNum,
              player,
            );
            if (existingFpmm) {
              logger.debug(
                `   Historical: Player ${player} (season ${seasonIdNum}) already has market, skipping`,
              );
              continue;
            }

            logger.info(
              `🎯 Historical threshold crossing: Player ${player} reached ${newShareBps} bps in season ${seasonIdNum}`,
            );

            // Trigger market creation
            if (paymasterService.initialized && infoFiFactoryAddress) {
              sseService.broadcastMarketCreationStarted({
                seasonId: seasonIdNum,
                player,
                probability: newShareBps,
              });

              const result = await paymasterService.createMarket(
                {
                  seasonId: seasonIdNum,
                  player,
                  oldTickets: oldTicketsNum,
                  newTickets: newTicketsNum,
                  totalTickets: totalTicketsNum,
                  infoFiFactoryAddress,
                },
                logger,
              );

              if (result.success) {
                logger.info(
                  `✅ Historical market creation confirmed: ${result.hash}`,
                );
                sseService.broadcastMarketCreationConfirmed({
                  seasonId: seasonIdNum,
                  player,
                  transactionHash: result.hash,
                  marketAddress: "pending",
                });
              } else {
                logger.error(
                  `❌ Historical market creation failed: ${result.error}`,
                );
                sseService.broadcastMarketCreationFailed({
                  seasonId: seasonIdNum,
                  player,
                  error: result.error,
                });

                try {
                  await db.logFailedMarketAttempt({
                    seasonId: seasonIdNum,
                    playerAddress: player,
                    source: "HISTORICAL_SCAN",
                    errorMessage: result.error,
                    attempts: result.attempts,
                  });
                } catch (logError) {
                  logger.warn(
                    `   ⚠️  Failed to record failed market attempt: ${logError.message}`,
                  );
                }
              }
            } else {
              logger.warn(
                `   ⚠️  PaymasterService not initialized, cannot create historical market for ${player}`,
              );
            }
          } catch (err) {
            logger.error(
              `   ❌ Error processing historical event for ${player}: ${err.message}`,
            );
          }
        }
      }
    } else {
      logger.info("   No historical PositionUpdate events found");
    }
  } catch (error) {
    logger.error(
      `❌ Failed to scan historical PositionUpdate events: ${error.message}`,
    );
    // Don't throw - continue with real-time listener
  }
}

/**
 * Starts listening for PositionUpdate events from SOFBondingCurve
 * Updates ALL players' win probabilities when any player's position changes
 * Triggers InfoFi market creation when player crosses 1% threshold
 *
 * @param {string} bondingCurveAddress - SOFBondingCurve contract address
 * @param {object} bondingCurveAbi - SOFBondingCurve ABI
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} raffleAbi - Raffle ABI
 * @param {string} raffleTokenAddress - RaffleToken contract address (for max supply)
 * @param {string} infoFiFactoryAddress - InfoFiMarketFactory contract address (for gasless market creation)
 * @param {object} logger - Fastify logger instance (app.log)
 * @returns {function} Unwatch function to stop listening
 */
export async function startPositionUpdateListener(
  bondingCurveAddress,
  bondingCurveAbi,
  raffleAddress,
  raffleAbi,
  raffleTokenAddress,
  infoFiFactoryAddress,
  logger,
) {
  // Validate inputs
  if (!bondingCurveAddress || !raffleAddress || !raffleTokenAddress) {
    throw new Error(
      "bondingCurveAddress, raffleAddress, and raffleTokenAddress are required",
    );
  }

  if (!bondingCurveAbi || !raffleAbi) {
    throw new Error("bondingCurveAbi and raffleAbi are required");
  }

  if (!logger) {
    throw new Error("logger instance is required");
  }

  // Initialize services
  const paymasterService = getPaymasterService(logger);
  const sseService = getSSEService(logger);

  // Initialize Paymaster service if not already done
  if (!paymasterService.initialized) {
    try {
      await paymasterService.initialize();
    } catch (error) {
      logger.warn(
        `⚠️  PaymasterService initialization failed: ${error.message}`,
      );
      logger.warn(`   Market creation will not be available`);
    }
  }

  // Fetch max supply from bonding curve's last step (the actual cap)
  let maxSupply = null;
  try {
    const bondSteps = await publicClient.readContract({
      address: bondingCurveAddress,
      abi: bondingCurveAbi,
      functionName: "getBondSteps",
    });
    // Last step's rangeTo is the max supply (raw token count, no decimals)
    if (bondSteps && bondSteps.length > 0) {
      const lastStep = bondSteps[bondSteps.length - 1];
      maxSupply = Number(lastStep.rangeTo);
    }
    logger.info(
      `   Max supply from bonding curve ${bondingCurveAddress}: ${maxSupply}`,
    );
  } catch (error) {
    logger.warn(
      `   Failed to fetch max supply from bonding curve: ${error.message}`,
    );
  }

  // Scan for historical PositionUpdate events that may have been missed
  await scanHistoricalPositionUpdateEvents(
    bondingCurveAddress,
    bondingCurveAbi,
    raffleAddress,
    raffleAbi,
    infoFiFactoryAddress,
    maxSupply,
    paymasterService,
    sseService,
    logger,
  );

  // Create persistent block cursor for this listener
  const blockCursor = await createBlockCursor(
    `${bondingCurveAddress}:PositionUpdate`,
  );

  const unwatch = await startContractEventPolling({
    client: publicClient,
    address: bondingCurveAddress,
    abi: bondingCurveAbi,
    eventName: "PositionUpdate",
    pollingIntervalMs: 3_000,
    maxBlockRange: 2_000n,
    blockCursor,
    onLogs: async (logs) => {
      for (const log of logs) {
        const { seasonId, player, oldTickets, newTickets, totalTickets } =
          log.args;

        try {
          // Convert BigInt values to numbers for database storage
          const seasonIdNum =
            typeof seasonId === "bigint" ? Number(seasonId) : seasonId;
          const oldTicketsNum =
            typeof oldTickets === "bigint" ? Number(oldTickets) : oldTickets;
          const newTicketsNum =
            typeof newTickets === "bigint" ? Number(newTickets) : newTickets;
          const totalTicketsNum =
            typeof totalTickets === "bigint"
              ? Number(totalTickets)
              : totalTickets;

          logger.debug(
            `📊 PositionUpdate Event: Season ${seasonIdNum}, Player ${player}, ` +
              `Tickets: ${oldTicketsNum} → ${newTicketsNum}, Total: ${totalTicketsNum}`,
          );

          // Step 1: Get all participants in this season
          logger.debug(`   Fetching participants for season ${seasonIdNum}...`);
          const participants = await publicClient.readContract({
            address: raffleAddress,
            abi: raffleAbi,
            functionName: "getParticipants",
            args: [seasonIdNum],
          });

          if (participants.length === 0) {
            logger.debug(`   No participants found in season ${seasonIdNum}`);
            return;
          }

          logger.debug(
            `   Found ${participants.length} participants in season ${seasonIdNum}`,
          );

          // Step 2: Ensure all participants exist in the players table
          logger.debug(
            `   Ensuring players table has ${participants.length} participant(s)...`,
          );
          for (const addr of participants) {
            try {
              await db.getOrCreatePlayerId(addr);
            } catch (playerError) {
              logger.warn(
                `   ⚠️  Failed to upsert player ${addr} into players table: ${playerError.message}`,
              );
            }
          }

          // Step 3: Fetch ticket count for each participant
          logger.debug(
            `   Fetching positions for ${participants.length} players...`,
          );
          const playerPositions = await Promise.all(
            participants.map(async (addr) => {
              const result = await publicClient.readContract({
                address: raffleAddress,
                abi: raffleAbi,
                functionName: "getParticipantPosition",
                args: [seasonIdNum, addr],
              });

              // Handle different return types
              let ticketCount;
              if (typeof result === "bigint") {
                ticketCount = Number(result);
              } else if (typeof result === "number") {
                ticketCount = result;
              } else if (result && typeof result === "object") {
                // If it's an object, try to extract the value
                // Could be {ticketCount: 1000n} or similar
                logger.debug(
                  `   Result for ${addr} is object with keys: ${Object.keys(
                    result,
                  ).join(", ")}`,
                );

                // Try common property names
                ticketCount =
                  result.ticketCount ||
                  result.tickets ||
                  result.amount ||
                  result[0];

                if (typeof ticketCount === "bigint") {
                  ticketCount = Number(ticketCount);
                } else if (typeof ticketCount === "number") {
                  // Already a number
                } else if (ticketCount && typeof ticketCount === "object") {
                  // Nested object, try to extract
                  ticketCount = Number(ticketCount);
                } else {
                  ticketCount = Number(ticketCount);
                }
              } else {
                ticketCount = Number(result);
              }

              logger.debug(`   ${addr}: ${ticketCount} tickets`);

              return {
                player: addr,
                ticketCount,
              };
            }),
          );

          logger.debug(
            `   Fetched positions for all ${playerPositions.length} players`,
          );

          // Step 4: Update all players' probabilities in database
          logger.debug(`   Updating probabilities in database...`);
          const updatedCount = await db.updateAllPlayerProbabilities(
            seasonIdNum,
            totalTicketsNum,
            playerPositions,
            maxSupply,
          );

          // Step 5: Update oracle for each player with an active market
          logger.debug(`   Updating oracle for players with active markets...`);
          let oracleUpdatesAttempted = 0;
          let oracleUpdatesSuccessful = 0;

          for (const { player: playerAddr, ticketCount } of playerPositions) {
            try {
              // Get FPMM address for this player
              const fpmmAddress = await db.getFpmmAddress(
                seasonIdNum,
                playerAddr,
              );

              if (fpmmAddress) {
                oracleUpdatesAttempted++;
                const newBps = Math.round(
                  (ticketCount * 10000) / totalTicketsNum,
                );

                // Call oracle service
                const result = await oracleCallService.updateRaffleProbability(
                  fpmmAddress,
                  newBps,
                  logger,
                );

                if (result.success) {
                  oracleUpdatesSuccessful++;
                  logger.debug(
                    `   ✅ Oracle updated for ${playerAddr}: ${newBps} bps (${result.hash})`,
                  );
                } else {
                  logger.warn(
                    `   ⚠️  Oracle update failed for ${playerAddr}: ${result.error}`,
                  );
                }
              }
            } catch (oracleError) {
              logger.warn(
                `   ⚠️  Error updating oracle for ${playerAddr}: ${oracleError.message}`,
              );
            }
          }

          // Step 5: Check if player crossed 1% threshold of MAX SUPPLY and trigger market creation
          // NOTE: Threshold is 1% of Max Supply (token cap), NOT 1% of current supply (totalTickets)
          const supplyForThreshold = maxSupply && maxSupply > 0 ? maxSupply : totalTicketsNum;
          const oldShareBps =
            oldTicketsNum > 0
              ? Math.round((oldTicketsNum * 10000) / supplyForThreshold)
              : 0;
          const newShareBps = Math.round(
            (newTicketsNum * 10000) / supplyForThreshold,
          );
          const thresholdBps = 100; // 1% = 100 basis points

          let marketCreationTriggered = false;
          if (
            oldShareBps < thresholdBps &&
            newShareBps >= thresholdBps
          ) {
            // Player crossed 1% threshold - trigger market creation
            marketCreationTriggered = true;
            logger.info(
              `🎯 Threshold crossed: Player ${player} reached ${newShareBps} bps (≥1%)`,
            );

            // Broadcast market creation started event
            sseService.broadcastMarketCreationStarted({
              seasonId: seasonIdNum,
              player,
              probability: newShareBps,
            });

            if (paymasterService.initialized && infoFiFactoryAddress) {
              try {
                logger.info(
                  "🚀 Submitting gasless market creation via Paymaster...",
                );
                const result = await paymasterService.createMarket(
                  {
                    seasonId: seasonIdNum,
                    player,
                    oldTickets: oldTicketsNum,
                    newTickets: newTicketsNum,
                    totalTickets: totalTicketsNum,
                    infoFiFactoryAddress,
                  },
                  logger,
                );

                if (result.success) {
                  logger.info(
                    `✅ Market creation confirmed: ${result.hash} (attempts: ${result.attempts})`,
                  );
                  sseService.broadcastMarketCreationConfirmed({
                    seasonId: seasonIdNum,
                    player,
                    transactionHash: result.hash,
                    marketAddress: "pending", // Will be updated when MarketCreated event is processed
                  });
                } else {
                  logger.error(
                    `❌ Market creation failed: ${result.error} (attempts: ${result.attempts})`,
                  );
                  sseService.broadcastMarketCreationFailed({
                    seasonId: seasonIdNum,
                    player,
                    error: result.error,
                  });

                  // Persist failed attempt for admin visibility and manual retry
                  try {
                    await db.logFailedMarketAttempt({
                      seasonId: seasonIdNum,
                      playerAddress: player,
                      source: "LISTENER",
                      errorMessage: result.error,
                      attempts: result.attempts,
                    });
                  } catch (logError) {
                    logger.warn(
                      `   ⚠️  Failed to record failed market attempt: ${logError.message}`,
                    );
                  }
                }
              } catch (error) {
                logger.error(`❌ Market creation error: ${error.message}`);
                sseService.broadcastMarketCreationFailed({
                  seasonId: seasonIdNum,
                  player,
                  error: error.message,
                });

                // Persist unexpected errors during market creation
                try {
                  await db.logFailedMarketAttempt({
                    seasonId: seasonIdNum,
                    playerAddress: player,
                    source: "LISTENER",
                    errorMessage: error.message,
                  });
                } catch (logError) {
                  logger.warn(
                    `   ⚠️  Failed to record failed market attempt: ${logError.message}`,
                  );
                }
              }
            } else {
              logger.warn(
                "⚠️  PaymasterService not initialized or InfoFi factory not configured, skipping market creation",
              );
            }
          }

          // Log success with detailed information
          logger.info(
            `✅ PositionUpdate: Season ${seasonIdNum}, Player ${player} ` +
              `(${oldTicketsNum} → ${newTicketsNum} tickets)`,
          );
          logger.info(
            `   Total tickets: ${totalTicketsNum} | Max supply: ${supplyForThreshold} | ` +
              `Updated ${updatedCount} markets | ` +
              `Oracle updates: ${oracleUpdatesSuccessful}/${oracleUpdatesAttempted} | ` +
              `Player probability: ${newShareBps} bps | ` +
              `Market creation: ${
                marketCreationTriggered ? "✅ Triggered" : "⏭️  Not triggered"
              }`,
          );

          // Record transaction in database
          try {
            const ticketDelta = newTicketsNum - oldTicketsNum;
            const transactionType = ticketDelta > 0 ? "BUY" : "SELL";

            // Get block timestamp
            const block = await publicClient.getBlock({
              blockNumber: log.blockNumber,
            });

            await raffleTransactionService.recordTransaction({
              seasonId: seasonIdNum,
              userAddress: player,
              transactionType,
              ticketAmount: Math.abs(ticketDelta),
              sofAmount: 0, // Will be updated when we can extract from tx
              txHash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              blockTimestamp: new Date(
                Number(block.timestamp) * 1000,
              ).toISOString(),
              ticketsBefore: oldTicketsNum,
              ticketsAfter: newTicketsNum,
            });

            logger.info(`   💾 Transaction recorded: ${log.transactionHash}`);
          } catch (txError) {
            logger.error(
              `   ❌ Failed to record transaction: ${txError.message}`,
            );
            // Don't crash listener - just log and continue
          }

          // Only validate probabilities if markets were actually updated
          if (updatedCount > 0) {
            // Log individual player probabilities for debugging
            logger.debug(`   Updated player probabilities:`);
            for (const { player: p, ticketCount } of playerPositions) {
              const newBps = Math.round(
                (ticketCount * 10000) / totalTicketsNum,
              );
              logger.debug(`     ${p}: ${ticketCount} tickets → ${newBps} bps`);
            }

            // Verify probabilities sum to 10000
            const totalBps = playerPositions.reduce((sum, { ticketCount }) => {
              return sum + Math.round((ticketCount * 10000) / totalTicketsNum);
            }, 0);

            if (totalBps !== 10000) {
              logger.warn(
                `⚠️  Probability sum mismatch: Expected 10000, got ${totalBps} ` +
                  `(difference: ${totalBps - 10000} bps)`,
              );
            }
          } else {
            logger.debug(
              `   No markets updated (players may not have crossed 1% threshold yet)`,
            );
          }
        } catch (error) {
          logger.error(
            `❌ Failed to process PositionUpdate for season ${seasonId}, player ${player}`,
          );
          logger.error(`   Error: ${error.message}`);
          logger.debug(`   Full error:`, error);
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
        logger.error({ errorDetails }, "❌ PositionUpdate Listener Error");
      } catch (logError) {
        logger.error(`❌ PositionUpdate Listener Error: ${String(logError)}`);
      }
    },
  });

  logger.info(
    `🎧 Listening for PositionUpdate events on ${bondingCurveAddress}`,
  );
  return unwatch;
}
