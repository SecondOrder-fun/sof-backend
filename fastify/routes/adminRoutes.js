// backend/fastify/routes/adminRoutes.js
// Admin routes for manual InfoFi market creation and season management

import process from "node:process";
import { parseAbi, formatEther } from "viem";
import { db, hasSupabase } from "../../shared/supabaseClient.js";
import { publicClient } from "../../src/lib/viemClient.js";
import { getChainByKey } from "../../src/config/chain.js";
import raffleAbi from "../../src/abis/RaffleAbi.js";
import { getPaymasterService } from "../../src/services/paymasterService.js";
import {
  sendNotificationToUser,
  sendNotificationToAll,
  getAllEnabledTokens,
} from "../../shared/farcasterNotificationService.js";
import { historicalOddsService } from "../../shared/historicalOddsService.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";

const erc20BalanceOfAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/**
 * Admin API routes
 */
export default async function adminRoutes(fastify) {
  const requireAdmin = createRequireAdmin();
  // Respect DEFAULT_NETWORK from .env, with LOCAL as final fallback
  const NETWORK =
    process.env.NETWORK ||
    process.env.DEFAULT_NETWORK ||
    process.env.VITE_DEFAULT_NETWORK ||
    "LOCAL";

  /**
   * GET /api/admin/backend-wallet
   * Returns the backend/paymaster wallet address, ETH balance, SOF balance, and network info.
   */
  fastify.get("/backend-wallet", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const chain = getChainByKey(NETWORK);
      const paymasterService = getPaymasterService(fastify.log);

      let walletAddress = null;
      let balanceEth = 0;
      let sofBalance = 0;

      // Try to get the smart account address from paymaster
      if (!paymasterService.initialized) {
        try {
          await paymasterService.initialize();
        } catch (_err) {
          // Will fall back to null address
        }
      }

      if (paymasterService.initialized) {
        try {
          walletAddress = paymasterService.getWalletAddress();
        } catch (_err) {
          // ignore
        }
      }

      // If no smart account, try the plain backend wallet from env
      if (!walletAddress) {
        walletAddress = process.env.BACKEND_WALLET_ADDRESS || null;
      }

      if (walletAddress) {
        try {
          const rawBal = await publicClient.getBalance({ address: walletAddress });
          balanceEth = parseFloat(formatEther(rawBal));
        } catch (_err) {
          // RPC may be down
        }

        // Read SOF balance if token address configured
        const sofAddress = chain.sof;
        if (sofAddress) {
          try {
            const rawSof = await publicClient.readContract({
              address: sofAddress,
              abi: erc20BalanceOfAbi,
              functionName: "balanceOf",
              args: [walletAddress],
            });
            sofBalance = parseFloat(formatEther(rawSof));
          } catch (_err) {
            // ignore
          }
        }
      }

      return reply.send({
        address: walletAddress,
        balanceEth,
        sofBalance,
        network: chain.name,
        chainId: chain.id,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch backend wallet info");
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/market-creation-stats
   * Returns aggregate statistics about InfoFi market creation.
   */
  fastify.get("/market-creation-stats", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      // Get all markets
      const { data: markets, error: marketsErr } = await db.client
        .from("infofi_markets")
        .select("id, contract_address, created_at, is_active")
        .order("created_at", { ascending: false });

      if (marketsErr) throw new Error(marketsErr.message);

      const allMarkets = markets || [];
      const totalCreated = allMarkets.length;
      const withContract = allMarkets.filter((m) => m.contract_address).length;
      const successRate = totalCreated > 0
        ? Math.round((withContract / totalCreated) * 100)
        : 0;

      // Get failed attempts count
      let failedAttempts = 0;
      try {
        const { count, error: failErr } = await db.client
          .from("infofi_failed_market_attempts")
          .select("id", { count: "exact", head: true });
        if (!failErr) failedAttempts = count || 0;
      } catch (_err) {
        // Table may not exist
      }

      // Recent markets (last 10)
      const recentMarkets = allMarkets.slice(0, 10).map((m) => ({
        id: m.id,
        hasContract: Boolean(m.contract_address),
        createdAt: m.created_at,
        isActive: m.is_active,
      }));

      return reply.send({
        totalCreated,
        successRate,
        totalGasEth: "0.0000", // Gasless via paymaster
        failedAttempts,
        recentMarkets,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch market creation stats");
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * GET /api/admin/active-seasons
   * Returns a list of active seasons for the ManualMarketCreation admin panel.
   * Shape: { seasons: [{ id, name, status }], count }
   */
  fastify.get("/active-seasons", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const seasons = [];
      const activeContracts = await db.getActiveSeasonContracts();

      for (const sc of activeContracts) {
        const seasonId = sc.season_id;
        let name = `Season ${seasonId}`;
        let status = "active";

        try {
          const raffle = await db.getRaffleById(seasonId);
          if (raffle) {
            if (raffle.name) name = raffle.name;
            if (raffle.status) status = raffle.status;
          }
        } catch (_err) {
          // If raffle row not found, fall back to defaults
        }

        seasons.push({ id: seasonId, name, status });
      }

      return reply.send({ seasons, count: seasons.length });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch active seasons");
      return reply.code(500).send({
        error: "Failed to fetch active seasons",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/admin/failed-market-attempts
   * Returns recent failed InfoFi market creation attempts.
   * Shape: { failedAttempts: [ { id, season_id, player_address, source, error_message, attempts, created_at, last_attempt_at } ], count }
   */
  fastify.get("/failed-market-attempts", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const failedAttempts = await db.getFailedMarketAttempts(100);
      return reply.send({
        failedAttempts,
        count: failedAttempts.length,
      });
    } catch (error) {
      fastify.log.error(
        { error },
        "Failed to fetch failed InfoFi market attempts"
      );
      return reply.code(500).send({
        error: "Failed to fetch failed market attempts",
        details: error.message,
      });
    }
  });

  /**
   * POST /api/admin/create-market
   * Manually trigger InfoFi market creation for a given season + player.
   * Uses the backend CDP smart account via PaymasterService to call
   * InfoFiMarketFactory.onPositionUpdate gaslessly.
   */
  fastify.post("/create-market", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { seasonId, playerAddress } = request.body || {};

      if (seasonId === undefined || seasonId === null) {
        return reply.code(400).send({ error: "seasonId is required" });
      }

      if (!playerAddress || typeof playerAddress !== "string") {
        return reply.code(400).send({ error: "playerAddress is required" });
      }

      if (!playerAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        return reply
          .code(400)
          .send({ error: "Invalid Ethereum address format" });
      }

      const seasonIdNum = Number(seasonId);
      if (!Number.isFinite(seasonIdNum) || seasonIdNum <= 0) {
        return reply
          .code(400)
          .send({ error: "seasonId must be a positive number" });
      }

      const isTestnet = NETWORK === "TESTNET";

      const raffleAddress = isTestnet
        ? process.env.RAFFLE_ADDRESS_TESTNET
        : process.env.RAFFLE_ADDRESS_LOCAL;

      const infoFiFactoryAddress = isTestnet
        ? process.env.INFOFI_FACTORY_ADDRESS_TESTNET
        : process.env.INFOFI_FACTORY_ADDRESS_LOCAL;

      if (!raffleAddress || !infoFiFactoryAddress) {
        return reply.code(500).send({
          error:
            "RAFFLE_ADDRESS and INFOFI_FACTORY_ADDRESS must be configured in environment variables",
        });
      }

      fastify.log.info(
        {
          seasonId: seasonIdNum,
          playerAddress,
          raffleAddress,
          infoFiFactoryAddress,
        },
        "Admin requested manual market creation"
      );

      // Read totalTickets from Raffle.getSeasonDetails
      const seasonDetails = await publicClient.readContract({
        address: raffleAddress,
        abi: raffleAbi,
        functionName: "getSeasonDetails",
        args: [seasonIdNum],
      });

      // getSeasonDetails returns (config, status, totalParticipants, totalTickets, totalPrizePool)
      const totalTicketsRaw = seasonDetails[3];
      const totalTicketsNum =
        typeof totalTicketsRaw === "bigint"
          ? Number(totalTicketsRaw)
          : Number(totalTicketsRaw || 0);

      if (!Number.isFinite(totalTicketsNum) || totalTicketsNum === 0) {
        return reply.code(400).send({
          error:
            "Total tickets is zero for this season; cannot compute market probabilities",
        });
      }

      // Read participant position to get current ticket count
      const rawPosition = await publicClient.readContract({
        address: raffleAddress,
        abi: raffleAbi,
        functionName: "getParticipantPosition",
        args: [seasonIdNum, playerAddress],
      });

      let ticketCount;
      if (typeof rawPosition === "bigint") {
        ticketCount = Number(rawPosition);
      } else if (typeof rawPosition === "number") {
        ticketCount = rawPosition;
      } else if (rawPosition && typeof rawPosition === "object") {
        // Try common struct shapes
        ticketCount =
          rawPosition.ticketCount ||
          rawPosition.tickets ||
          rawPosition.amount ||
          rawPosition[0];

        if (typeof ticketCount === "bigint") {
          ticketCount = Number(ticketCount);
        } else {
          ticketCount = Number(ticketCount || 0);
        }
      } else {
        ticketCount = Number(rawPosition || 0);
      }

      if (!Number.isFinite(ticketCount) || ticketCount <= 0) {
        return reply.code(400).send({
          error:
            "Player has zero tickets in this season; no market should be created",
        });
      }

      const paymasterService = getPaymasterService(fastify.log);
      if (!paymasterService.initialized) {
        await paymasterService.initialize();
      }

      const result = await paymasterService.createMarket(
        {
          seasonId: seasonIdNum,
          player: playerAddress,
          oldTickets: 0,
          newTickets: ticketCount,
          totalTickets: totalTicketsNum,
          infoFiFactoryAddress,
        },
        fastify.log
      );

      if (!result.success) {
        // Persist failed attempt so admin can see and retry later
        try {
          await db.logFailedMarketAttempt({
            seasonId: seasonIdNum,
            playerAddress,
            source: "ADMIN",
            errorMessage: result.error,
            attempts: result.attempts,
          });
        } catch (logError) {
          fastify.log.warn(
            { error: logError },
            "Failed to record failed admin market attempt"
          );
        }

        return reply.code(500).send({
          error: result.error || "Market creation failed",
          attempts: result.attempts,
        });
      }

      return reply.send({
        success: true,
        transactionHash: result.hash,
        attempts: result.attempts,
        gasUsed: null,
      });
    } catch (error) {
      fastify.log.error(
        { error },
        "Unexpected error in /api/admin/create-market"
      );

      // Best-effort logging of unexpected admin failures
      try {
        const body = request.body || {};
        const rawSeasonId = body.seasonId;
        const seasonIdNum =
          typeof rawSeasonId === "number" ? rawSeasonId : Number(rawSeasonId);

        await db.logFailedMarketAttempt({
          seasonId: Number.isFinite(seasonIdNum) ? seasonIdNum : null,
          playerAddress: body.playerAddress,
          source: "ADMIN",
          errorMessage: error.message,
        });
      } catch (logError) {
        fastify.log.warn(
          { error: logError },
          "Failed to record unexpected admin market failure"
        );
      }

      return reply.code(500).send({
        error: "Failed to create market",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/admin/paymaster-status
   * Returns basic health information for the CDP Paymaster-backed smart account
   * Shape: { network, isTestnet, entryPointAddress, paymasterUrlConfigured, initialized, smartAccountAddress, initializationError }
   */
  fastify.get("/paymaster-status", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      const {
        DEFAULT_NETWORK,
        PAYMASTER_RPC_URL,
        PAYMASTER_RPC_URL_TESTNET,
        ENTRY_POINT_ADDRESS,
      } = process.env;

      const network =
        DEFAULT_NETWORK ||
        NETWORK ||
        process.env.VITE_DEFAULT_NETWORK ||
        "LOCAL";
      const isTestnet = network === "TESTNET";
      const paymasterUrl = isTestnet
        ? PAYMASTER_RPC_URL_TESTNET
        : PAYMASTER_RPC_URL;

      const paymasterService = getPaymasterService(fastify.log);

      let initialized = paymasterService.initialized;
      let smartAccountAddress = null;
      let initializationError = null;

      // Try to initialize on-demand if not already initialized
      if (!initialized) {
        try {
          await paymasterService.initialize();
          initialized = true;
        } catch (err) {
          initializationError = err.message;
        }
      }

      if (initialized) {
        try {
          smartAccountAddress = paymasterService.getWalletAddress();
        } catch (err) {
          initializationError = initializationError || err.message;
        }
      }

      return reply.send({
        network,
        isTestnet,
        entryPointAddress: ENTRY_POINT_ADDRESS || null,
        paymasterUrlConfigured: Boolean(paymasterUrl),
        initialized,
        smartAccountAddress,
        initializationError,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch paymaster status");
      return reply.code(500).send({
        error: "Failed to fetch paymaster status",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/admin/notification-stats
   * Returns statistics about notification tokens
   * Shape: { totalTokens, uniqueUsers, byClient: { [appFid]: count } }
   */
  fastify.get("/notification-stats", { preHandler: requireAdmin }, async (_request, reply) => {
    try {
      if (!hasSupabase) {
        return reply.code(503).send({
          error: "Supabase not configured",
        });
      }

      const tokens = await getAllEnabledTokens();

      // Calculate stats
      const uniqueFids = new Set(tokens.map((t) => t.fid));

      return reply.send({
        totalTokens: tokens.length,
        uniqueUsers: uniqueFids.size,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch notification stats");
      return reply.code(500).send({
        error: "Failed to fetch notification stats",
        details: error.message,
      });
    }
  });

  /**
   * POST /api/admin/send-notification
   * Send a notification to a specific user or all users
   * Body: { fid?: number, title: string, body: string, targetUrl?: string }
   * If fid is provided, sends to that user only. Otherwise broadcasts to all.
   */
  fastify.post("/send-notification", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { fid, title, body, targetUrl } = request.body || {};

      if (!title || typeof title !== "string") {
        return reply.code(400).send({ error: "title is required" });
      }

      if (!body || typeof body !== "string") {
        return reply.code(400).send({ error: "body is required" });
      }

      const notificationTargetUrl = targetUrl || "https://secondorder.fun";

      let result;

      if (fid !== undefined && fid !== null) {
        // Send to specific user
        const fidNum = Number(fid);
        if (!Number.isFinite(fidNum) || fidNum <= 0) {
          return reply
            .code(400)
            .send({ error: "fid must be a positive number" });
        }

        fastify.log.info(
          { fid: fidNum, title },
          "[Admin] Sending notification to user"
        );

        result = await sendNotificationToUser({
          fid: fidNum,
          title,
          body,
          targetUrl: notificationTargetUrl,
        });
      } else {
        // Broadcast to all users
        fastify.log.info(
          { title },
          "[Admin] Broadcasting notification to all users"
        );

        result = await sendNotificationToAll({
          title,
          body,
          targetUrl: notificationTargetUrl,
        });
      }

      return reply.send({
        success: result.state === "success",
        ...result,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to send notification");
      return reply.code(500).send({
        error: "Failed to send notification",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/admin/notification-tokens
   * Returns list of all notification tokens (for admin viewing)
   * Shape: { tokens: [...], count }
   */
  fastify.get("/notification-tokens", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      if (!hasSupabase) {
        return reply.code(503).send({
          error: "Supabase not configured",
        });
      }

      const { data, error } = await db.client
        .from("farcaster_notification_tokens")
        .select(
          "id, fid, app_key, notification_url, notifications_enabled, created_at, updated_at"
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        throw new Error(error.message);
      }

      return reply.send({
        tokens: data || [],
        count: (data || []).length,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch notification tokens");
      return reply.code(500).send({
        error: "Failed to fetch notification tokens",
        details: error.message,
      });
    }
  });

  /**
   * POST /api/admin/backfill-initial-odds
   * Backfill the initial odds data point for all markets that are missing it.
   * Reads the FPMM getPrices() at a block near creation time and inserts
   * that as the first historical odds data point (the "Market Start" point).
   *
   * Body (optional): { dryRun: boolean }
   */
  fastify.post("/backfill-initial-odds", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const { dryRun = false } = request.body || {};
      const simpleFpmmAbi = (await import("../../src/abis/SimpleFPMMAbi.js")).default;

      // Get all markets with contract addresses
      const { data: markets, error } = await db.client
        .from("infofi_markets")
        .select("id, season_id, contract_address, created_at, current_probability_bps")
        .not("contract_address", "is", null)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      if (!markets || markets.length === 0) {
        return reply.send({ message: "No markets found", backfilled: 0 });
      }

      // Get current block info for estimating historical blocks
      const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
      const currentBlockNumber = Number(latestBlock.number);
      const currentTimestamp = Number(latestBlock.timestamp);

      const results = [];

      for (const market of markets) {
        const seasonId = market.season_id ?? 0;
        const marketId = market.id;

        try {
          // Check if this market already has odds history
          const stats = await historicalOddsService.getStats(seasonId, marketId);
          const createdAtMs = new Date(market.created_at).getTime();

          // If the oldest data point is within 60s of creation, skip (already has initial point)
          if (stats.count > 0 && stats.oldestTimestamp && Math.abs(stats.oldestTimestamp - createdAtMs) < 60000) {
            results.push({
              marketId,
              status: "skipped",
              reason: "Initial odds already recorded",
              existingOldest: stats.oldestTimestamp,
              createdAt: createdAtMs,
            });
            continue;
          }

          // Estimate the block number at creation time
          const createdAtSec = Math.floor(createdAtMs / 1000);
          const secondsAgo = currentTimestamp - createdAtSec;
          const blocksAgo = Math.floor(secondsAgo / 2); // ~2s per block on Base Sepolia
          const estimatedBlock = currentBlockNumber - blocksAgo;

          // Try to read FPMM prices at a block slightly after creation
          // Add 100 blocks (~200s buffer) to ensure contract exists
          const targetBlock = estimatedBlock + 100;

          let initialYesBps;
          let initialNoBps;
          let source;

          try {
            const [yesPrice, noPrice] = await publicClient.readContract({
              address: market.contract_address,
              abi: simpleFpmmAbi,
              functionName: "getPrices",
              blockNumber: BigInt(targetBlock),
            });
            initialYesBps = Number(yesPrice);
            initialNoBps = Number(noPrice);
            source = `block_${targetBlock}`;
          } catch (blockReadError) {
            // Fallback: use stored probability from DB (set at creation time)
            fastify.log.warn(
              `[BACKFILL] Could not read FPMM at block ${targetBlock} for market ${marketId}: ${blockReadError.message}. Using DB probability.`
            );
            initialYesBps = market.current_probability_bps || 5000;
            initialNoBps = 10000 - initialYesBps;
            source = "db_fallback";
          }

          if (!dryRun) {
            await historicalOddsService.recordOddsUpdate(seasonId, marketId, {
              timestamp: createdAtMs,
              yes_bps: initialYesBps,
              no_bps: initialNoBps,
              hybrid_bps: initialYesBps,
              raffle_bps: 0,
              sentiment_bps: 0,
            });
          }

          results.push({
            marketId,
            seasonId,
            status: dryRun ? "dry_run" : "backfilled",
            initialYesBps,
            initialNoBps,
            createdAt: market.created_at,
            createdAtMs,
            source,
            estimatedBlock: targetBlock,
          });

          fastify.log.info(
            `[BACKFILL] ${dryRun ? "[DRY RUN] " : ""}Market ${marketId}: initial odds ${initialYesBps}/${initialNoBps} bps at ${market.created_at} (source: ${source})`
          );
        } catch (marketError) {
          results.push({
            marketId,
            status: "error",
            error: marketError.message,
          });
        }
      }

      const backfilledCount = results.filter((r) => r.status === "backfilled").length;
      return reply.send({
        backfilled: backfilledCount,
        total: markets.length,
        dryRun,
        results,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to backfill initial odds");
      return reply.code(500).send({
        error: "Failed to backfill initial odds",
        details: error.message,
      });
    }
  });

  /**
   * POST /api/admin/refresh-probabilities
   * Force-refresh all active market probabilities from on-chain FPMM prices
   */
  fastify.post("/refresh-probabilities", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const simpleFpmmAbi = (await import("../../src/abis/SimpleFPMMAbi.js")).default;

      // Get all active markets
      const { data: markets, error } = await db.client
        .from("infofi_markets")
        .select("id, contract_address, current_probability_bps")
        .eq("is_active", true)
        .not("contract_address", "is", null);

      if (error) throw new Error(error.message);
      if (!markets || markets.length === 0) {
        return reply.send({ message: "No active markets", updated: 0 });
      }

      const results = [];

      for (const market of markets) {
        try {
          // Read on-chain prices
          const [yesPrice, noPrice] = await publicClient.readContract({
            address: market.contract_address,
            abi: simpleFpmmAbi,
            functionName: "getPrices",
          });

          const newProbBps = Number(yesPrice);

          // Update DB
          const { data: updated, error: updateError } = await db.client
            .from("infofi_markets")
            .update({
              current_probability_bps: newProbBps,
              updated_at: new Date().toISOString(),
            })
            .eq("id", market.id)
            .select("id, current_probability_bps, updated_at")
            .single();

          if (updateError) {
            results.push({
              id: market.id,
              address: market.contract_address,
              error: updateError.message,
              old: market.current_probability_bps,
              new: newProbBps,
            });
          } else {
            results.push({
              id: market.id,
              address: market.contract_address,
              old: market.current_probability_bps,
              new: newProbBps,
              updated: true,
            });
          }
        } catch (marketError) {
          results.push({
            id: market.id,
            address: market.contract_address,
            error: marketError.message,
          });
        }
      }

      const successCount = results.filter((r) => r.updated).length;
      return reply.send({
        updated: successCount,
        total: markets.length,
        results,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to refresh probabilities");
      return reply.code(500).send({
        error: "Failed to refresh probabilities",
        details: error.message,
      });
    }
  });
}
