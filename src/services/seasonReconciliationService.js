import { publicClient } from "../lib/viemClient.js";
import { db, hasSupabase } from "../../shared/supabaseClient.js";

/**
 * Reconcile season contract addresses from the Raffle contract into the database.
 *
 * This prevents missing PositionUpdate listeners (and thus missing InfoFi market creation)
 * when the backend is down or restarts and misses SeasonStarted events.
 *
 * @param {object} params
 * @param {string} params.raffleAddress
 * @param {object} params.raffleAbi
 * @param {object} params.logger
 * @param {(seasonData: { seasonId: number, bondingCurveAddress: string, raffleTokenAddress: string }) => Promise<void>} params.onSeasonActive
 * @returns {Promise<{ latestSeasonId: number, inspected: number, upserted: number, activated: number }>} Summary
 */
export async function reconcileSeasonsFromChain({
  raffleAddress,
  raffleAbi,
  logger,
  onSeasonActive,
}) {
  if (!raffleAddress) {
    throw new Error("raffleAddress is required");
  }

  if (!raffleAbi) {
    throw new Error("raffleAbi is required");
  }

  if (!logger) {
    throw new Error("logger is required");
  }

  if (typeof onSeasonActive !== "function") {
    throw new Error("onSeasonActive is required");
  }

  if (!hasSupabase) {
    logger.warn(
      "⚠️  Supabase not configured; skipping season reconciliation (season_contracts will not be updated)",
    );
    return {
      latestSeasonId: 0,
      inspected: 0,
      upserted: 0,
      activated: 0,
    };
  }

  const latestSeasonIdRaw = await publicClient.readContract({
    address: raffleAddress,
    abi: raffleAbi,
    functionName: "currentSeasonId",
    args: [],
  });

  const latestSeasonId =
    typeof latestSeasonIdRaw === "bigint"
      ? Number(latestSeasonIdRaw)
      : Number(latestSeasonIdRaw);

  if (!Number.isFinite(latestSeasonId) || latestSeasonId <= 0) {
    logger.warn(
      `⚠️  Raffle.currentSeasonId returned invalid value: ${String(latestSeasonIdRaw)}`,
    );
    return {
      latestSeasonId: 0,
      inspected: 0,
      upserted: 0,
      activated: 0,
    };
  }

  logger.info(
    `🔄 Season reconciliation: syncing season_contracts for seasons 1..${latestSeasonId}`,
  );

  let inspected = 0;
  let upserted = 0;
  let activated = 0;

  for (let seasonId = 1; seasonId <= latestSeasonId; seasonId += 1) {
    inspected += 1;

    const existing = await db.getSeasonContracts(seasonId);

    // Read on-chain details
    const seasonDetails = await publicClient.readContract({
      address: raffleAddress,
      abi: raffleAbi,
      functionName: "getSeasonDetails",
      args: [BigInt(seasonId)],
    });

    const config = seasonDetails[0];
    const raffleTokenAddress = config.raffleToken;
    const bondingCurveAddress = config.bondingCurve;
    const isActive = Boolean(config.isActive);

    const shouldUpsert =
      !existing ||
      !existing.bonding_curve_address ||
      !existing.raffle_token_address ||
      existing.raffle_address?.toLowerCase() !== raffleAddress.toLowerCase();

    // Always update is_active if it drifted
    const shouldUpdateActiveFlag =
      existing && typeof existing.is_active === "boolean" && existing.is_active !== isActive;

    if (shouldUpsert || shouldUpdateActiveFlag) {
      await db.createSeasonContracts({
        season_id: seasonId,
        bonding_curve_address: bondingCurveAddress,
        raffle_token_address: raffleTokenAddress,
        raffle_address: raffleAddress,
        is_active: isActive,
      });
      upserted += 1;

      logger.info(
        `✅ Upserted season_contracts for season ${seasonId} (active=${isActive})`,
      );
      logger.info(`   BondingCurve: ${bondingCurveAddress}`);
      logger.info(`   RaffleToken: ${raffleTokenAddress}`);
    }

    if (isActive) {
      await onSeasonActive({
        seasonId,
        bondingCurveAddress,
        raffleTokenAddress,
      });
      activated += 1;
    }
  }

  logger.info(
    `✅ Season reconciliation complete: latestSeasonId=${latestSeasonId} inspected=${inspected} upserted=${upserted} active=${activated}`,
  );

  return {
    latestSeasonId,
    inspected,
    upserted,
    activated,
  };
}
