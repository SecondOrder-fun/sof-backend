// tests/api/infoFiAdminRoutes.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { infoFiAdminService } from '../../backend/shared/infoFiAdminService.js';

// Mock the database client
vi.mock('../../backend/shared/supabaseClient.js', () => ({
  db: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      })),
    })),
  },
}));

describe('InfoFi Admin Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMarketsAdminSummary', () => {
    it('should return empty seasons array when no markets exist', async () => {
      const result = await infoFiAdminService.getMarketsAdminSummary();

      expect(result.success).toBe(true);
      expect(result.data.seasons).toEqual([]);
      expect(result.data.totalMarkets).toBe(0);
      expect(result.data.totalActiveMarkets).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      const { db } = await import('../../backend/shared/supabaseClient.js');
      
      db.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              data: null,
              error: { message: 'Database connection failed' },
            })),
          })),
        })),
      });

      const result = await infoFiAdminService.getMarketsAdminSummary();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
    });

    it('should group markets by season correctly', async () => {
      const mockMarkets = [
        {
          id: 1,
          raffle_id: 1,
          market_type: 'WINNER_PREDICTION',
          total_volume: '100',
          is_active: true,
          is_settled: false,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          raffles: { season_id: 1 },
          players: { address: '0x1234567890123456789012345678901234567890' },
          hybrid_pricing_cache: {
            volume_24h: '10',
            hybrid_price: '0.5',
            price_change_24h: '2',
            last_updated: '2025-01-01T12:00:00Z',
          },
        },
        {
          id: 2,
          raffle_id: 1,
          market_type: 'POSITION_SIZE',
          total_volume: '50',
          is_active: true,
          is_settled: false,
          created_at: '2025-01-01T01:00:00Z',
          updated_at: '2025-01-01T01:00:00Z',
          raffles: { season_id: 1 },
          players: { address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' },
          hybrid_pricing_cache: {
            volume_24h: '5',
            hybrid_price: '0.3',
            price_change_24h: '-1',
            last_updated: '2025-01-01T12:00:00Z',
          },
        },
      ];

      const { db } = await import('../../backend/shared/supabaseClient.js');
      
      db.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              data: mockMarkets,
              error: null,
            })),
          })),
        })),
      });

      const result = await infoFiAdminService.getMarketsAdminSummary();

      expect(result.success).toBe(true);
      expect(result.data.seasons).toHaveLength(1);
      expect(result.data.seasons[0].seasonId).toBe(1);
      expect(result.data.seasons[0].markets).toHaveLength(2);
      expect(result.data.seasons[0].totalMarkets).toBe(2);
      expect(result.data.seasons[0].activeMarkets).toBe(2);
      expect(result.data.seasons[0].totalVolume).toBe(150);
    });

    it('should convert snake_case to camelCase correctly', async () => {
      const mockMarkets = [
        {
          id: 1,
          raffle_id: 1,
          market_type: 'WINNER_PREDICTION',
          total_volume: '100',
          is_active: true,
          is_settled: false,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          raffles: { season_id: 1 },
          players: { address: '0x1234567890123456789012345678901234567890' },
          hybrid_pricing_cache: null,
        },
      ];

      const { db } = await import('../../backend/shared/supabaseClient.js');
      
      db.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(() => ({
              data: mockMarkets,
              error: null,
            })),
          })),
        })),
      });

      const result = await infoFiAdminService.getMarketsAdminSummary();

      expect(result.success).toBe(true);
      const market = result.data.seasons[0].markets[0];
      expect(market).toHaveProperty('raffleId');
      expect(market).toHaveProperty('seasonId');
      expect(market).toHaveProperty('marketType');
      expect(market).toHaveProperty('playerAddress');
      expect(market).toHaveProperty('totalVolume');
      expect(market).toHaveProperty('isActive');
      expect(market).toHaveProperty('isSettled');
    });
  });

  describe('getMarketLiquidity', () => {
    it('should return liquidity metrics for a valid market', async () => {
      const mockLiquidity = {
        volume_24h: '100',
        price_change_24h: '5',
        last_updated: '2025-01-01T12:00:00Z',
      };

      const { db } = await import('../../backend/shared/supabaseClient.js');
      
      db.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: mockLiquidity,
              error: null,
            })),
          })),
        })),
      });

      const result = await infoFiAdminService.getMarketLiquidity(1);

      expect(result.success).toBe(true);
      expect(result.data.volume24h).toBe('100');
      expect(result.data.priceChange24h).toBe('5');
    });

    it('should handle missing liquidity data gracefully', async () => {
      const { db } = await import('../../backend/shared/supabaseClient.js');
      
      db.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({
              data: null,
              error: null,
            })),
          })),
        })),
      });

      const result = await infoFiAdminService.getMarketLiquidity(999);

      expect(result.success).toBe(true);
      expect(result.data.volume24h).toBe('0');
      expect(result.data.priceChange24h).toBe('0');
    });
  });
});
