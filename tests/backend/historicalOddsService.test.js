// tests/backend/historicalOddsService.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { historicalOddsService } from '../../backend/shared/historicalOddsService.js';

/**
 * Unit tests for Historical Odds Service
 * Tests Redis-based time-series storage for market odds data
 */

// Mock Redis client
const mockRedis = {
  zadd: vi.fn(),
  zcard: vi.fn(),
  zremrangebyrank: vi.fn(),
  expire: vi.fn(),
  zrangebyscore: vi.fn(),
  zremrangebyscore: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
  zrange: vi.fn(),
};

// Mock redisClient module
vi.mock('../../backend/shared/redisClient.js', () => ({
  redisClient: {
    getClient: () => mockRedis,
  },
}));

describe('HistoricalOddsService', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
    // Reset service state
    historicalOddsService.redis = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('recordOddsUpdate', () => {
    it('should record a new odds data point', async () => {
      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.zcard.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const oddsData = {
        timestamp: Date.now(),
        yes_bps: 4500,
        no_bps: 5500,
        hybrid_bps: 4500,
        raffle_bps: 4200,
        sentiment_bps: 5000,
      };

      await historicalOddsService.recordOddsUpdate(1, 0, oddsData);

      // Verify zadd was called with correct key and data
      expect(mockRedis.zadd).toHaveBeenCalledTimes(1);
      const [key, timestamp, member] = mockRedis.zadd.mock.calls[0];
      expect(key).toBe('odds:history:1:0');
      expect(timestamp).toBe(oddsData.timestamp);
      
      const parsedMember = JSON.parse(member);
      expect(parsedMember.yes_bps).toBe(4500);
      expect(parsedMember.no_bps).toBe(5500);

      // Verify expiration was set
      expect(mockRedis.expire).toHaveBeenCalledWith('odds:history:1:0', 90 * 24 * 60 * 60);
    });

    it('should trim old entries when max points exceeded', async () => {
      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.zcard.mockResolvedValue(100001); // Over max
      mockRedis.zremrangebyrank.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const oddsData = {
        timestamp: Date.now(),
        yes_bps: 5000,
        no_bps: 5000,
        hybrid_bps: 5000,
        raffle_bps: 5000,
        sentiment_bps: 5000,
      };

      await historicalOddsService.recordOddsUpdate(1, 0, oddsData);

      // Verify trimming was called
      expect(mockRedis.zremrangebyrank).toHaveBeenCalledWith('odds:history:1:0', 0, 0);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.zadd.mockRejectedValue(new Error('Redis connection failed'));

      const oddsData = {
        timestamp: Date.now(),
        yes_bps: 5000,
        no_bps: 5000,
        hybrid_bps: 5000,
        raffle_bps: 5000,
        sentiment_bps: 5000,
      };

      // Should not throw
      await expect(
        historicalOddsService.recordOddsUpdate(1, 0, oddsData)
      ).resolves.toBeUndefined();
    });
  });

  describe('getHistoricalOdds', () => {
    it('should retrieve historical odds for a time range', async () => {
      const mockDataPoints = [
        JSON.stringify({ timestamp: 1000, yes_bps: 4500, no_bps: 5500, hybrid_bps: 4500, raffle_bps: 4200, sentiment_bps: 5000 }),
        '1000',
        JSON.stringify({ timestamp: 2000, yes_bps: 4600, no_bps: 5400, hybrid_bps: 4600, raffle_bps: 4300, sentiment_bps: 5100 }),
        '2000',
      ];
      
      mockRedis.zrangebyscore.mockResolvedValue(mockDataPoints);

      const result = await historicalOddsService.getHistoricalOdds(1, 0, '1D');

      expect(result.dataPoints).toHaveLength(2);
      expect(result.dataPoints[0].yes_bps).toBe(4500);
      expect(result.dataPoints[1].yes_bps).toBe(4600);
      expect(result.count).toBe(2);
      expect(result.downsampled).toBe(false);
    });

    it('should downsample data when exceeding max points', async () => {
      // Create 600 mock data points (exceeds 500 max)
      const mockDataPoints = [];
      for (let i = 0; i < 600; i++) {
        mockDataPoints.push(
          JSON.stringify({ 
            timestamp: i * 1000, 
            yes_bps: 5000, 
            no_bps: 5000, 
            hybrid_bps: 5000, 
            raffle_bps: 5000, 
            sentiment_bps: 5000 
          })
        );
        mockDataPoints.push(String(i * 1000));
      }
      
      mockRedis.zrangebyscore.mockResolvedValue(mockDataPoints);

      const result = await historicalOddsService.getHistoricalOdds(1, 0, 'ALL');

      expect(result.count).toBeLessThanOrEqual(500);
      expect(result.downsampled).toBe(true);
    });

    it('should handle malformed data points', async () => {
      const mockDataPoints = [
        'invalid json',
        '1000',
        JSON.stringify({ timestamp: 2000, yes_bps: 4600, no_bps: 5400, hybrid_bps: 4600, raffle_bps: 4300, sentiment_bps: 5100 }),
        '2000',
      ];
      
      mockRedis.zrangebyscore.mockResolvedValue(mockDataPoints);

      const result = await historicalOddsService.getHistoricalOdds(1, 0, '1D');

      // Should skip malformed data and return valid point
      expect(result.dataPoints).toHaveLength(1);
      expect(result.dataPoints[0].yes_bps).toBe(4600);
    });

    it('should return empty array on Redis error', async () => {
      mockRedis.zrangebyscore.mockRejectedValue(new Error('Redis error'));

      const result = await historicalOddsService.getHistoricalOdds(1, 0, '1D');

      expect(result.dataPoints).toEqual([]);
      expect(result.count).toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  describe('cleanupOldData', () => {
    it('should remove entries older than retention period', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(10);

      const removed = await historicalOddsService.cleanupOldData(1, 0);

      expect(removed).toBe(10);
      expect(mockRedis.zremrangebyscore).toHaveBeenCalledTimes(1);
      
      const [key, minScore, maxScore] = mockRedis.zremrangebyscore.mock.calls[0];
      expect(key).toBe('odds:history:1:0');
      expect(minScore).toBe(0);
      expect(maxScore).toBeLessThan(Date.now());
    });

    it('should handle cleanup errors gracefully', async () => {
      mockRedis.zremrangebyscore.mockRejectedValue(new Error('Redis error'));

      const removed = await historicalOddsService.cleanupOldData(1, 0);

      expect(removed).toBe(0);
    });
  });

  describe('clearMarketHistory', () => {
    it('should delete all data for a market', async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await historicalOddsService.clearMarketHistory(1, 0);

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('odds:history:1:0');
    });

    it('should handle deletion errors', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      const result = await historicalOddsService.clearMarketHistory(1, 0);

      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return statistics about stored data', async () => {
      mockRedis.zcard.mockResolvedValue(100);
      mockRedis.ttl.mockResolvedValue(7776000); // 90 days in seconds
      mockRedis.zrange
        .mockResolvedValueOnce(['data', '1000']) // oldest
        .mockResolvedValueOnce(['data', '10000']); // newest

      const stats = await historicalOddsService.getStats(1, 0);

      expect(stats.count).toBe(100);
      expect(stats.ttl).toBe(7776000);
      expect(stats.oldestTimestamp).toBe(1000);
      expect(stats.newestTimestamp).toBe(10000);
      expect(stats.key).toBe('odds:history:1:0');
    });

    it('should handle empty data set', async () => {
      mockRedis.zcard.mockResolvedValue(0);
      mockRedis.ttl.mockResolvedValue(-1);

      const stats = await historicalOddsService.getStats(1, 0);

      expect(stats.count).toBe(0);
      expect(stats.oldestTimestamp).toBeNull();
      expect(stats.newestTimestamp).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      mockRedis.zcard.mockRejectedValue(new Error('Redis error'));

      const stats = await historicalOddsService.getStats(1, 0);

      expect(stats.count).toBe(0);
      expect(stats.error).toBeDefined();
    });
  });

  describe('_downsampleData', () => {
    it('should not downsample if under max points', () => {
      const dataPoints = [
        { timestamp: 1000, yes_bps: 5000, no_bps: 5000, hybrid_bps: 5000, raffle_bps: 5000, sentiment_bps: 5000 },
        { timestamp: 2000, yes_bps: 5100, no_bps: 4900, hybrid_bps: 5100, raffle_bps: 5100, sentiment_bps: 5100 },
      ];

      const result = historicalOddsService._downsampleData(dataPoints, 500);

      expect(result).toEqual(dataPoints);
    });

    it('should average values when downsampling', () => {
      const dataPoints = [
        { timestamp: 1000, yes_bps: 4000, no_bps: 6000, hybrid_bps: 4000, raffle_bps: 4000, sentiment_bps: 4000 },
        { timestamp: 2000, yes_bps: 6000, no_bps: 4000, hybrid_bps: 6000, raffle_bps: 6000, sentiment_bps: 6000 },
      ];

      const result = historicalOddsService._downsampleData(dataPoints, 1);

      expect(result).toHaveLength(1);
      expect(result[0].yes_bps).toBe(5000); // Average of 4000 and 6000
      expect(result[0].no_bps).toBe(5000);
    });
  });

  describe('_getKey', () => {
    it('should generate correct Redis key', () => {
      const key = historicalOddsService._getKey(1, 5);
      expect(key).toBe('odds:history:1:5');
    });

    it('should handle string IDs', () => {
      const key = historicalOddsService._getKey('1', '5');
      expect(key).toBe('odds:history:1:5');
    });
  });
});
