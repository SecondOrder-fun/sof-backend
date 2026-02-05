import { redisClient } from "./redisClient.js";

const VALID_RANGES = new Set(["1H", "6H", "1D", "1W", "1M", "ALL"]);
const MAX_POINTS = 500;
const MAX_STORED_POINTS = 100000;
const RETENTION_SECONDS = 90 * 24 * 60 * 60;

/**
 * Historical odds storage backed by Redis sorted sets.
 */
class HistoricalOddsService {
  constructor() {
    this.redis = null;
  }

  /**
   * Initialize Redis client reference.
   * @returns {void}
   */
  init() {
    if (!this.redis) {
      this.redis = redisClient.getClient();
    }
  }

  /**
   * Record a new odds data point for a market.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @param {Object} oddsData - Odds snapshot.
   * @param {number} oddsData.timestamp - Timestamp in ms.
   * @param {number} oddsData.yes_bps - YES odds in bps.
   * @param {number} oddsData.no_bps - NO odds in bps.
   * @param {number} oddsData.hybrid_bps - Hybrid odds in bps.
   * @param {number} oddsData.raffle_bps - Raffle odds in bps.
   * @param {number} oddsData.sentiment_bps - Sentiment odds in bps.
   * @returns {Promise<void>}
   */
  async recordOddsUpdate(seasonId, marketId, oddsData) {
    try {
      this.init();
      if (!this.redis || !oddsData?.timestamp) {
        return;
      }

      const key = this._getKey(seasonId, marketId);
      const payload = JSON.stringify(oddsData);

      await this.redis.zadd(key, oddsData.timestamp, payload);

      const count = await this.redis.zcard(key);
      if (count > MAX_STORED_POINTS) {
        const excess = count - MAX_STORED_POINTS;
        await this.redis.zremrangebyrank(key, 0, excess - 1);
      }

      await this.redis.expire(key, RETENTION_SECONDS);
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

      this.init();
      if (!this.redis) {
        return { dataPoints: [], count: 0, downsampled: false };
      }

      const key = this._getKey(seasonId, marketId);
      const now = Date.now();
      const minScore = this._getRangeStart(range, now);

      // For non-ALL ranges, prepend the last data point before the window
      // so the graph has a "carry-forward" anchor at the left edge
      let anchorPoint = null;
      if (range !== "ALL" && minScore > 0) {
        const anchorRaw = await this.redis.zrevrangebyscore(
          key,
          minScore - 1,
          0,
          "WITHSCORES",
          "LIMIT",
          0,
          1,
        );
        if (anchorRaw.length >= 2) {
          try {
            const parsed = JSON.parse(anchorRaw[0]);
            // Project the anchor to the range start time so the graph
            // begins at the left edge with the last known value
            anchorPoint = { ...parsed, timestamp: minScore };
          } catch (_) {
            // skip malformed anchor
          }
        }
      }

      const raw = await this.redis.zrangebyscore(
        key,
        minScore,
        now,
        "WITHSCORES",
      );

      const dataPoints = [];

      // Insert anchor as the first point if we have one
      if (anchorPoint) {
        dataPoints.push(anchorPoint);
      }

      for (let i = 0; i < raw.length; i += 2) {
        try {
          const point = JSON.parse(raw[i]);
          dataPoints.push(point);
        } catch (parseError) {
          console.warn("[historicalOddsService] Skipping invalid odds point");
        }
      }

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
      this.init();
      if (!this.redis) {
        return 0;
      }

      const key = this._getKey(seasonId, marketId);
      const cutoff = Date.now() - RETENTION_SECONDS * 1000;
      return await this.redis.zremrangebyscore(key, 0, cutoff);
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
      this.init();
      if (!this.redis) {
        return false;
      }

      const key = this._getKey(seasonId, marketId);
      const result = await this.redis.del(key);
      return result > 0;
    } catch (error) {
      console.error("[historicalOddsService] Failed to clear history", error);
      return false;
    }
  }

  /**
   * Retrieve stats about stored market odds.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @returns {Promise<{count: number, ttl: number, oldestTimestamp: number|null, newestTimestamp: number|null, key: string, error?: string}>}
   */
  async getStats(seasonId, marketId) {
    const key = this._getKey(seasonId, marketId);

    try {
      this.init();
      if (!this.redis) {
        return {
          count: 0,
          ttl: -1,
          oldestTimestamp: null,
          newestTimestamp: null,
          key,
        };
      }

      const count = await this.redis.zcard(key);
      const ttl = await this.redis.ttl(key);

      if (count === 0) {
        return {
          count: 0,
          ttl,
          oldestTimestamp: null,
          newestTimestamp: null,
          key,
        };
      }

      const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const newest = await this.redis.zrange(key, -1, -1, "WITHSCORES");

      return {
        count,
        ttl,
        oldestTimestamp: oldest[1] ? Number(oldest[1]) : null,
        newestTimestamp: newest[1] ? Number(newest[1]) : null,
        key,
      };
    } catch (error) {
      console.error("[historicalOddsService] Failed to fetch stats", error);
      return {
        count: 0,
        ttl: -1,
        oldestTimestamp: null,
        newestTimestamp: null,
        key,
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
   * Build Redis key for a market history set.
   * @param {number|string} seasonId - Season identifier.
   * @param {number|string} marketId - Market identifier.
   * @returns {string}
   */
  _getKey(seasonId, marketId) {
    return `odds:history:${seasonId}:${marketId}`;
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
