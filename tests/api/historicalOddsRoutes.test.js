// tests/api/historicalOddsRoutes.test.js
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { infoFiRoutes } from '../../backend/fastify/routes/infoFiRoutes.js';

/**
 * Integration tests for Historical Odds API endpoint
 * Tests the /api/infofi/markets/:marketId/history endpoint
 */

// Mock dependencies
vi.mock('../../backend/shared/supabaseClient.js', () => ({
  db: {
    getInfoFiMarketById: vi.fn(),
  },
}));

vi.mock('../../backend/shared/historicalOddsService.js', () => ({
  historicalOddsService: {
    getHistoricalOdds: vi.fn(),
  },
}));

vi.mock('../../backend/shared/pricingService.js', () => ({
  pricingService: {
    getCachedPricing: vi.fn(),
    subscribeToMarket: vi.fn(() => () => {}),
  },
}));

vi.mock('../../backend/shared/marketMakerService.js', () => ({
  marketMakerService: {
    quote: vi.fn(),
    buy: vi.fn(),
    sell: vi.fn(),
  },
}));

vi.mock('../../backend/src/lib/viemClient.js', () => ({
  getPublicClient: vi.fn(),
}));

vi.mock('../../backend/src/config/chain.js', () => ({
  getChainByKey: vi.fn(),
}));

import { db } from '../../backend/shared/supabaseClient.js';
import { historicalOddsService } from '../../backend/shared/historicalOddsService.js';

describe('Historical Odds API Routes', () => {
  let app;

  beforeAll(async () => {
    app = Fastify();
    await app.register(infoFiRoutes, { prefix: '/api/infofi' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/infofi/markets/:marketId/history', () => {
    it('should return historical odds data for valid market', async () => {
      // Mock market lookup
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        season_id: 1,
        market_type: 'WINNER_PREDICTION',
      });

      // Mock historical data
      historicalOddsService.getHistoricalOdds.mockResolvedValue({
        dataPoints: [
          {
            timestamp: 1729260000000,
            yes_bps: 4500,
            no_bps: 5500,
            hybrid_bps: 4500,
            raffle_bps: 4200,
            sentiment_bps: 5000,
          },
          {
            timestamp: 1729263600000,
            yes_bps: 4600,
            no_bps: 5400,
            hybrid_bps: 4600,
            raffle_bps: 4300,
            sentiment_bps: 5100,
          },
        ],
        count: 2,
        downsampled: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history?range=1D',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.marketId).toBe('0');
      expect(body.seasonId).toBe('1');
      expect(body.range).toBe('1D');
      expect(body.dataPoints).toHaveLength(2);
      expect(body.count).toBe(2);
      expect(body.downsampled).toBe(false);
    });

    it('should default to ALL range when not specified', async () => {
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        season_id: 1,
      });

      historicalOddsService.getHistoricalOdds.mockResolvedValue({
        dataPoints: [],
        count: 0,
        downsampled: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.range).toBe('ALL');
    });

    it('should reject invalid time range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history?range=INVALID',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid time range');
    });

    it('should return 404 for non-existent market', async () => {
      db.getInfoFiMarketById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/999/history?range=1D',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Market not found');
    });

    it('should handle service errors gracefully', async () => {
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        season_id: 1,
      });

      historicalOddsService.getHistoricalOdds.mockRejectedValue(
        new Error('Redis connection failed')
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history?range=1D',
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Failed to fetch historical odds');
      expect(body.message).toBe('Redis connection failed');
    });

    it('should support all valid time ranges', async () => {
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        season_id: 1,
      });

      historicalOddsService.getHistoricalOdds.mockResolvedValue({
        dataPoints: [],
        count: 0,
        downsampled: false,
      });

      const validRanges = ['1H', '6H', '1D', '1W', '1M', 'ALL'];

      for (const range of validRanges) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/infofi/markets/0/history?range=${range}`,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.range).toBe(range);
      }
    });

    it('should include downsampled flag in response', async () => {
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        season_id: 1,
      });

      historicalOddsService.getHistoricalOdds.mockResolvedValue({
        dataPoints: Array(500).fill({
          timestamp: Date.now(),
          yes_bps: 5000,
          no_bps: 5000,
          hybrid_bps: 5000,
          raffle_bps: 5000,
          sentiment_bps: 5000,
        }),
        count: 500,
        downsampled: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history?range=ALL',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.downsampled).toBe(true);
      expect(body.count).toBe(500);
    });

    it('should use raffle_id as fallback for season_id', async () => {
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        raffle_id: 2, // No season_id, use raffle_id
      });

      historicalOddsService.getHistoricalOdds.mockResolvedValue({
        dataPoints: [],
        count: 0,
        downsampled: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history?range=1D',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.seasonId).toBe('2');
      
      // Verify service was called with raffle_id
      expect(historicalOddsService.getHistoricalOdds).toHaveBeenCalledWith(
        2,
        '0',
        '1D'
      );
    });

    it('should default to 0 when no season or raffle ID', async () => {
      db.getInfoFiMarketById.mockResolvedValue({
        id: 0,
        // No season_id or raffle_id
      });

      historicalOddsService.getHistoricalOdds.mockResolvedValue({
        dataPoints: [],
        count: 0,
        downsampled: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/infofi/markets/0/history?range=1D',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.seasonId).toBe('0');
    });
  });
});
