import fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import process from "node:process";
import { hasSupabase, db } from "../shared/supabaseClient.js";
import { startSeasonStartedListener } from "../src/listeners/seasonStartedListener.js";
import { startSeasonCompletedListener } from "../src/listeners/seasonCompletedListener.js";
import { startPositionUpdateListener } from "../src/listeners/positionUpdateListener.js";
import { startMarketCreatedListener } from "../src/listeners/marketCreatedListener.js";
import { startTradeListener } from "../src/listeners/tradeListener.js";
import { infoFiPositionService } from "../src/services/infoFiPositionService.js";
import { raffleTransactionService } from "../src/services/raffleTransactionService.js";
import raffleAbi from "../src/abis/RaffleAbi.js";
import sofBondingCurveAbi from "../src/abis/SOFBondingCurveAbi.js";
import infoFiMarketFactoryAbi from "../src/abis/InfoFiMarketFactoryAbi.js";
import simpleFpmmAbi from "../src/abis/SimpleFPMMAbi.js";

// Create Fastify instance
const app = fastify({ logger: true });

// Select network ("LOCAL" or "TESTNET") for on-chain listeners
// Respect DEFAULT_NETWORK from .env, with LOCAL as final fallback
const NETWORK =
  process.env.DEFAULT_NETWORK || process.env.VITE_DEFAULT_NETWORK || "LOCAL";
app.log.info({ NETWORK }, "Using backend network configuration");

// Log Supabase connection status at startup
if (hasSupabase) {
  app.log.info("✅ Supabase configured and connected");
} else {
  app.log.warn("⚠️  Supabase NOT configured - database operations will fail");
  app.log.warn("    Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
}

// Register plugins
const corsOriginsEnv = process.env.CORS_ORIGINS;
let corsOrigin;

if (corsOriginsEnv && corsOriginsEnv.trim().length > 0) {
  // Comma-separated list from env, e.g. "http://127.0.0.1:5173,http://localhost:5173,https://secondorder.fun"
  corsOrigin = corsOriginsEnv
    .split(",")
    .map((v) => {
      const trimmed = v.trim();
      // Normalize: strip a single trailing slash so
      // "https://foo.com/" matches origin "https://foo.com".
      return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
    })
    .filter(Boolean);
} else {
  corsOrigin =
    process.env.NODE_ENV === "production"
      ? ["https://secondorder.fun", "https://www.secondorder.fun"]
      : true; // Allow all origins in development
}

await app.register(cors, {
  origin: corsOrigin,
  credentials: true,
});

await app.register(helmet);

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// Log every route as it is registered to diagnose mounting issues
app.addHook("onRoute", (routeOptions) => {
  try {
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method.join(",")
      : routeOptions.method;
    app.log.info(
      { method: methods, url: routeOptions.url, prefix: routeOptions.prefix },
      "route added"
    );
  } catch (e) {
    app.log.error({ e }, "Failed to log route");
  }
});

// Register routes (use default export from dynamic import)
try {
  await app.register((await import("./routes/healthRoutes.js")).default, {
    prefix: "/api",
  });
  app.log.info("Mounted /api/health");
} catch (err) {
  app.log.error({ err }, "Failed to mount /api/health");
}

try {
  await app.register((await import("./routes/usernameRoutes.js")).default, {
    prefix: "/api/usernames",
  });
  app.log.info("Mounted /api/usernames");
} catch (err) {
  app.log.error({ err }, "Failed to mount /api/usernames");
}

try {
  await app.register((await import("./routes/userRoutes.js")).default, {
    prefix: "/api/users",
  });
  app.log.info("Mounted /api/users");
} catch (err) {
  app.log.error({ err }, "Failed to mount /api/users");
}

try {
  await app.register((await import("./routes/infoFiRoutes.js")).default, {
    prefix: "/api/infofi",
  });
  app.log.info("Mounted /api/infofi");
} catch (err) {
  app.log.error({ err }, "Failed to mount /api/infofi");
}

try {
  await app.register((await import("./routes/adminRoutes.js")).default, {
    prefix: "/api/admin",
  });
  app.log.info("Mounted /api/admin");
} catch (err) {
  app.log.error({ err }, "Failed to mount /api/admin");
}

try {
  await app.register(
    (
      await import("./routes/raffleTransactionRoutes.js")
    ).default,
    {
      prefix: "/api/raffle",
    }
  );
  app.log.info("Mounted /api/raffle");
} catch (err) {
  app.log.error({ err }, "Failed to mount /api/raffle");
}

// Debug: print all mounted routes
// app.ready(() => {
//   try {
//     app.log.info("Route tree start");
//     app.log.info("\n" + app.printRoutes());
//     app.log.info("Route tree end");
//   } catch (e) {
//     app.log.error({ e }, "Failed to print routes");
//   }
// });

// Error handling
app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.status(500).send({ error: "Internal Server Error" });
});

// 404 handler
app.setNotFoundHandler((_request, reply) => {
  reply.status(404).send({ error: "Not Found" });
});

// Initialize listeners
let unwatchSeasonStarted;
let unwatchSeasonCompleted;
let unwatchMarketCreated;
const positionUpdateListeners = new Map(); // Map of seasonId -> unwatch function
const tradeListeners = new Map(); // Map of fpmmAddress -> unwatch function

async function startListeners() {
  try {
    const isTestnet = NETWORK === "TESTNET";

    const raffleAddress = isTestnet
      ? process.env.RAFFLE_ADDRESS_TESTNET
      : process.env.RAFFLE_ADDRESS_LOCAL;

    const infoFiFactoryAddress = isTestnet
      ? process.env.INFOFI_FACTORY_ADDRESS_TESTNET
      : process.env.INFOFI_FACTORY_ADDRESS_LOCAL;

    if (!raffleAddress) {
      app.log.warn(
        `⚠️  Raffle address env not set for NETWORK=${NETWORK} - SeasonStarted listener will not start`
      );
      return;
    }

    // Callback to start PositionUpdate listener when a season starts
    const onSeasonCreated = async (seasonData) => {
      const { seasonId, bondingCurveAddress, raffleTokenAddress } = seasonData;

      try {
        app.log.info(
          `🎧 Starting PositionUpdate listener for season ${seasonId}`
        );

        const unwatch = await startPositionUpdateListener(
          bondingCurveAddress,
          sofBondingCurveAbi,
          raffleAddress,
          raffleAbi,
          raffleTokenAddress,
          infoFiFactoryAddress,
          app.log
        );

        // Store unwatch function for cleanup
        positionUpdateListeners.set(seasonId, unwatch);
        app.log.info(
          `✅ PositionUpdate listener started for season ${seasonId}`
        );
      } catch (error) {
        app.log.error(
          `❌ Failed to start PositionUpdate listener for season ${seasonId}: ${error.message}`
        );
      }
    };

    // Discover existing seasons and start listeners for them
    if (hasSupabase) {
      try {
        app.log.info("🔍 Discovering existing seasons...");
        const existingSeasons = await db.getActiveSeasonContracts();

        if (existingSeasons && existingSeasons.length > 0) {
          app.log.info(`Found ${existingSeasons.length} active season(s)`);

          for (const season of existingSeasons) {
            await onSeasonCreated({
              seasonId: season.season_id,
              bondingCurveAddress: season.bonding_curve_address,
              raffleTokenAddress: season.raffle_token_address,
            });
          }
        } else {
          app.log.info("No existing seasons found");
        }
      } catch (error) {
        app.log.error(`Failed to discover existing seasons: ${error.message}`);
      }
    }

    // Start SeasonStarted listener (which will trigger PositionUpdate listeners)
    unwatchSeasonStarted = await startSeasonStartedListener(
      raffleAddress,
      raffleAbi,
      app.log,
      onSeasonCreated
    );

    // Start SeasonCompleted listener (marks seasons as inactive when they end)
    unwatchSeasonCompleted = await startSeasonCompletedListener(
      raffleAddress,
      raffleAbi,
      app.log
    );

    // Resolve InfoFi factory address based on NETWORK (already computed above)
    if (infoFiFactoryAddress) {
      try {
        app.log.info("🎧 Starting MarketCreated listener...");
        unwatchMarketCreated = await startMarketCreatedListener(
          infoFiFactoryAddress,
          infoFiMarketFactoryAbi,
          app.log
        );
        app.log.info("✅ MarketCreated listener started");
      } catch (error) {
        app.log.error(
          `❌ Failed to start MarketCreated listener: ${error.message}`
        );
      }
    } else {
      // No InfoFi factory configured for this environment; skip listener entirely
      app.log.error(
        "No INFOFI_MARKET_FACTORY contract configured (INFOFI_FACTORY_ADDRESS_" +
          (NETWORK === "TESTNET" ? "TESTNET" : "LOCAL") +
          ") - MarketCreated listener will not start"
      );
    }

    // Start Trade listeners for FPMM contracts
    // Get list of active FPMM addresses from database
    if (hasSupabase) {
      try {
        app.log.info("🎧 Starting Trade listeners for FPMM contracts...");
        const activeFpmmAddresses = await db.getActiveFpmmAddresses();

        if (activeFpmmAddresses && activeFpmmAddresses.length > 0) {
          app.log.info(
            `Found ${activeFpmmAddresses.length} active FPMM contract(s)`
          );

          const unwatchFunctions = await startTradeListener(
            activeFpmmAddresses,
            simpleFpmmAbi,
            app.log
          );

          // Store unwatch functions for cleanup
          unwatchFunctions.forEach((unwatch, index) => {
            tradeListeners.set(activeFpmmAddresses[index], unwatch);
          });

          app.log.info(
            `✅ Trade listeners started for ${activeFpmmAddresses.length} FPMM contract(s)`
          );
        } else {
          app.log.info(
            "No active FPMM contracts found - Trade listeners not started"
          );
        }
      } catch (error) {
        app.log.error(`❌ Failed to start Trade listeners: ${error.message}`);
      }
    }
  } catch (error) {
    app.log.error("Failed to start listeners:", error);
    // Don't crash server, but log the error
  }
}

/**
 * Sync historical positions for all active markets
 * Runs on server startup to catch any missed trades
 */
async function syncHistoricalPositions() {
  try {
    app.log.info("🔄 Starting historical position sync...");

    const result = await infoFiPositionService.syncAllActiveMarkets();

    if (result.success) {
      app.log.info(
        `✅ Historical sync complete: ${result.totalRecorded} new positions recorded, ` +
          `${result.totalSkipped} already synced, ${
            result.totalErrors || 0
          } errors`
      );

      if (result.details && result.details.length > 0) {
        app.log.debug({ markets: result.details }, "Sync details by market");
      }
    } else {
      app.log.warn("⚠️  Historical sync completed with issues");
    }
  } catch (error) {
    app.log.error("Failed to sync historical positions:", error);
    // Don't crash server, but log the error
  }
}

/**
 * Sync historical raffle transactions for all active seasons
 * Runs on server startup to populate transaction history
 */
async function syncHistoricalTransactions() {
  try {
    app.log.info("🎫 Starting historical transaction sync...");

    // Get bonding curve address from environment
    const bondingCurveAddress =
      process.env[`BONDING_CURVE_ADDRESS_${NETWORK}`] ||
      process.env.BONDING_CURVE_ADDRESS_TESTNET;

    if (!bondingCurveAddress) {
      app.log.warn(
        "⚠️  No bonding curve address configured, skipping transaction sync"
      );
      return;
    }

    const results = await raffleTransactionService.syncAllActiveSeasons(
      bondingCurveAddress
    );

    const totalRecorded = results.reduce(
      (sum, r) => sum + (r.recorded || 0),
      0
    );
    const totalSkipped = results.reduce((sum, r) => sum + (r.skipped || 0), 0);
    const totalErrors = results.reduce((sum, r) => sum + (r.errors || 0), 0);

    app.log.info(
      `✅ Historical transaction sync complete: ${totalRecorded} new transactions, ` +
        `${totalSkipped} already synced, ${totalErrors} errors`
    );

    if (results.length > 0) {
      app.log.debug({ seasons: results }, "Sync details by season");
    }
  } catch (error) {
    app.log.error("Failed to sync historical transactions:", error);
    // Don't crash server, but log the error
  }
}

// Start server
const PORT = process.env.PORT || 3000;

try {
  //await app.listen({ port: Number(PORT), host: "127.0.0.1" });
  await app.listen({ port: Number(PORT), host: "0.0.0.0" });
  app.log.info(`🚀 Server listening on port ${PORT}`);

  // Start listeners in background (non-blocking)
  // This prevents slow listener initialization from blocking server readiness
  startListeners().catch((err) => {
    app.log.error({ err }, "Failed to start listeners");
  });

  // Sync historical positions in background (non-blocking)
  syncHistoricalPositions().catch((err) => {
    app.log.error({ err }, "Failed to sync historical positions");
  });

  // Sync historical transactions in background (non-blocking)
  syncHistoricalTransactions().catch((err) => {
    app.log.error({ err }, "Failed to sync historical transactions");
  });

  app.log.info("✅ Server ready - listeners and sync starting in background");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
let isShuttingDown = false;

process.on("SIGINT", async () => {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    app.log.warn("⚠️  Shutdown already in progress, ignoring duplicate SIGINT");
    return;
  }

  isShuttingDown = true;
  app.log.info("Shutting down server...");

  try {
    // Stop all listeners
    if (unwatchSeasonStarted) {
      unwatchSeasonStarted();
      app.log.info("🛑 Stopped SeasonStarted listener");
    }

    if (unwatchSeasonCompleted) {
      unwatchSeasonCompleted();
      app.log.info("🛑 Stopped SeasonCompleted listener");
    }

    if (unwatchMarketCreated) {
      unwatchMarketCreated();
      app.log.info("🛑 Stopped MarketCreated listener");
    }

    // Stop all PositionUpdate listeners
    for (const [seasonId, unwatch] of positionUpdateListeners.entries()) {
      unwatch();
      app.log.info(`🛑 Stopped PositionUpdate listener for season ${seasonId}`);
    }

    // Stop all Trade listeners
    for (const [fpmmAddress, unwatch] of tradeListeners.entries()) {
      unwatch();
      app.log.info(`🛑 Stopped Trade listener for FPMM ${fpmmAddress}`);
    }

    await app.close();
    app.log.info("✅ Server shut down gracefully");
  } catch (error) {
    app.log.error({ error }, "Error during shutdown");
  }

  process.exit(0);
});

export { app };
