import { supabase, hasSupabase } from "./supabaseClient.js";

const VALID_RANGES = new Set(["1H", "6H", "1D", "1W", "1M", "ALL"]);
const MAX_POINTS = 500;
const RETENTION_DAYS = 90;

/**
 * Historical odds storage backed by Supabase (infofi_odds_history table).
 */
class HistoricalOddsService {
  /**
   * Record a new odds data point for a market.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @param {Object} oddsData - Odds snapshot.
   * @param {number} oddsData.timestamp - Timestamp in ms.
   * @param {number} oddsData.yes_bps - YES odds in bps.
   * @param {number} oddsData.no_bps - NO odds in bps.
   * @param {number} [oddsData.hybrid_bps] - Hybrid odds in bps.
   * @param {number} [oddsData.raffle_bps] - Raffle odds in bps.
   * @param {number} [oddsData.sentiment_bps] - Sentiment odds in bps.
   * @returns {Promise<void>}
   */
  async recordOddsUpdate(seasonId, marketId, oddsData) {
    try {
      if (!hasSupabase || !oddsData?.timestamp) {
        return;
      }

      const { error } = await supabase.from("infofi_odds_history").insert({
        market_id: Number(marketId),
        season_id: Number(seasonId),
        recorded_at: new Date(oddsData.timestamp).toISOString(),
        yes_bps: oddsData.yes_bps,
        no_bps: oddsData.no_bps,
        hybrid_bps: oddsData.hybrid_bps || 0,
        raffle_bps: oddsData.raffle_bps || 0,
        sentiment_bps: oddsData.sentiment_bps || 0,
      });

      if (error) {
        console.error(
          "[historicalOddsService] Failed to record odds:",
          error.message,
        );
      }
    } catch (error) {
      console.error("[historicalOddsService] Failed to record odds", error);
    }
  }

  /**
   * Retrieve historical odds for a market.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @param {string} range - Time range code.
   * @returns {Promise<{dataPoints: Array, count: number, downsampled: boolean, error?: string}>}
   */
  async getHistoricalOdds(seasonId, marketId, range = "ALL") {
    try {
      if (!VALID_RANGES.has(range)) {
        throw new Error(`Invalid time range: ${range}`);
      }

      if (!hasSupabase) {
        return { dataPoints: [], count: 0, downsampled: false };
      }

      let query = supabase
        .from("infofi_odds_history")
        .select(
          "recorded_at, yes_bps, no_bps, hybrid_bps, raffle_bps, sentiment_bps",
        )
        .eq("market_id", Number(marketId))
        .order("recorded_at", { ascending: true });

      // Apply time range filter
      if (range !== "ALL") {
        const minDate = new Date(this._getRangeStart(range, Date.now()));
        query = query.gte("recorded_at", minDate.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(error.message);
      }

      // Transform rows to match the existing API contract
      const dataPoints = (data || []).map((row) => ({
        timestamp: new Date(row.recorded_at).getTime(),
        yes_bps: row.yes_bps,
        no_bps: row.no_bps,
        hybrid_bps: row.hybrid_bps,
        raffle_bps: row.raffle_bps,
        sentiment_bps: row.sentiment_bps,
      }));

      const needsDownsample = dataPoints.length > MAX_POINTS;
      const finalPoints = needsDownsample
        ? this._downsampleData(dataPoints, MAX_POINTS)
        : dataPoints;

      return {
        dataPoints: finalPoints,
        count: finalPoints.length,
        downsampled: needsDownsample,
      };
    } catch (error) {
      console.error("[historicalOddsService] Failed to fetch odds", error);
      return {
        dataPoints: [],
        count: 0,
        downsampled: false,
        error: error.message,
      };
    }
  }

  /**
   * Remove data older than retention window.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @returns {Promise<number>}
   */
  async cleanupOldData(seasonId, marketId) {
    try {
      if (!hasSupabase) {
        return 0;
      }

      const cutoff = new Date(
        Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      const { data, error } = await supabase
        .from("infofi_odds_history")
        .delete()
        .eq("market_id", Number(marketId))
        .lt("recorded_at", cutoff.toISOString())
        .select("id");

      if (error) {
        console.error(
          "[historicalOddsService] Cleanup failed:",
          error.message,
        );
        return 0;
      }

      return data?.length || 0;
    } catch (error) {
      console.error("[historicalOddsService] Cleanup failed", error);
      return 0;
    }
  }

  /**
   * Delete all stored odds for a market.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @returns {Promise<boolean>}
   */
  async clearMarketHistory(seasonId, marketId) {
    try {
      if (!hasSupabase) {
        return false;
      }

      const { error } = await supabase
        .from("infofi_odds_history")
        .delete()
        .eq("market_id", Number(marketId));

      if (error) {
        console.error(
          "[historicalOddsService] Failed to clear history:",
          error.message,
        );
        return false;
      }

      return true;
    } catch (error) {
      console.error("[historicalOddsService] Failed to clear history", error);
      return false;
    }
  }

  /**
   * Retrieve stats about stored market odds.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @returns {Promise<{count: number, oldestTimestamp: number|null, newestTimestamp: number|null, error?: string}>}
   */
  async getStats(seasonId, marketId) {
    try {
      if (!hasSupabase) {
        return { count: 0, oldestTimestamp: null, newestTimestamp: null };
      }

      // Get count
      const { count, error: countError } = await supabase
        .from("infofi_odds_history")
        .select("id", { count: "exact", head: true })
        .eq("market_id", Number(marketId));

      if (countError) {
        throw new Error(countError.message);
      }

      if (!count || count === 0) {
        return { count: 0, oldestTimestamp: null, newestTimestamp: null };
      }

      // Get oldest
      const { data: oldest } = await supabase
        .from("infofi_odds_history")
        .select("recorded_at")
        .eq("market_id", Number(marketId))
        .order("recorded_at", { ascending: true })
        .limit(1)
        .single();

      // Get newest
      const { data: newest } = await supabase
        .from("infofi_odds_history")
        .select("recorded_at")
        .eq("market_id", Number(marketId))
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single();

      return {
        count,
        oldestTimestamp: oldest
          ? new Date(oldest.recorded_at).getTime()
          : null,
        newestTimestamp: newest
          ? new Date(newest.recorded_at).getTime()
          : null,
      };
    } catch (error) {
      console.error("[historicalOddsService] Failed to fetch stats", error);
      return {
        count: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
        error: error.message,
      };
    }
  }

  /**
   * Downsample data points by averaging buckets.
   * @param {Array} dataPoints - Raw data points.
   * @param {number} maxPoints - Maximum points to return.
   * @returns {Array}
   */
  _downsampleData(dataPoints, maxPoints) {
    if (dataPoints.length <= maxPoints) {
      return dataPoints;
    }

    const bucketSize = Math.ceil(dataPoints.length / maxPoints);
    const downsampled = [];

    for (let i = 0; i < dataPoints.length; i += bucketSize) {
      const bucket = dataPoints.slice(i, i + bucketSize);
      const totals = bucket.reduce(
        (acc, point) => ({
          yes_bps: acc.yes_bps + point.yes_bps,
          no_bps: acc.no_bps + point.no_bps,
          hybrid_bps: acc.hybrid_bps + point.hybrid_bps,
          raffle_bps: acc.raffle_bps + point.raffle_bps,
          sentiment_bps: acc.sentiment_bps + point.sentiment_bps,
          timestamp: acc.timestamp + point.timestamp,
        }),
        {
          yes_bps: 0,
          no_bps: 0,
          hybrid_bps: 0,
          raffle_bps: 0,
          sentiment_bps: 0,
          timestamp: 0,
        },
      );

      const size = bucket.length;
      downsampled.push({
        timestamp: Math.round(totals.timestamp / size),
        yes_bps: Math.round(totals.yes_bps / size),
        no_bps: Math.round(totals.no_bps / size),
        hybrid_bps: Math.round(totals.hybrid_bps / size),
        raffle_bps: Math.round(totals.raffle_bps / size),
        sentiment_bps: Math.round(totals.sentiment_bps / size),
      });
    }

    return downsampled;
  }

  /**
   * Resolve range start timestamp.
   * @param {string} range - Range code.
   * @param {number} now - Current timestamp.
   * @returns {number}
   */
  _getRangeStart(range, now) {
    switch (range) {
      case "1H":
        return now - 1 * 60 * 60 * 1000;
      case "6H":
        return now - 6 * 60 * 60 * 1000;
      case "1D":
        return now - 24 * 60 * 60 * 1000;
      case "1W":
        return now - 7 * 24 * 60 * 60 * 1000;
      case "1M":
        return now - 30 * 24 * 60 * 60 * 1000;
      case "ALL":
      default:
        return 0;
    }
  }
}

export const historicalOddsService = new HistoricalOddsService();
export const historicalOddsRanges = Array.from(VALID_RANGES);
