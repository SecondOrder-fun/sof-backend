// backend/fastify/routes/adminRoutes.js
// Admin routes for manual InfoFi market creation and season management

import process from "node:process";
import { db } from "../../shared/supabaseClient.js";
import { publicClient } from "../../src/lib/viemClient.js";
import raffleAbi from "../../src/abis/RaffleAbi.js";
import { getPaymasterService } from "../../src/services/paymasterService.js";

/**
 * Admin API routes
 */
export default async function adminRoutes(fastify) {
  // Respect DEFAULT_NETWORK from .env, with LOCAL as final fallback
  const NETWORK =
    process.env.NETWORK ||
    process.env.DEFAULT_NETWORK ||
    process.env.VITE_DEFAULT_NETWORK ||
    "LOCAL";

  /**
   * GET /api/admin/active-seasons
   * Returns a list of active seasons for the ManualMarketCreation admin panel.
   * Shape: { seasons: [{ id, name, status }], count }
   */
  fastify.get("/active-seasons", async (_request, reply) => {
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
  fastify.get("/failed-market-attempts", async (_request, reply) => {
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
  fastify.post("/create-market", async (request, reply) => {
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
  fastify.get("/paymaster-status", async (_request, reply) => {
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
          smartAccountAddress = paymasterService.getSmartAccountAddress();
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
}
