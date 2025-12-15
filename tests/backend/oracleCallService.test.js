/**
 * @file oracleCallService.test.js
 * @description Unit tests for OracleCallService
 * @date Oct 30, 2025
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OracleCallService } from '../../backend/src/services/oracleCallService.js';

describe('OracleCallService', () => {
  let service;
  let mockLogger;
  let mockWalletClient;
  let mockPublicClient;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Mock wallet and public clients
    mockWalletClient = {
      writeContract: vi.fn(),
    };

    mockPublicClient = {
      waitForTransactionReceipt: vi.fn(),
    };

    // Mock environment variables
    vi.stubEnv('INFOFI_ORACLE_ADDRESS_LOCAL', '0x1234567890123456789012345678901234567890');
    vi.stubEnv('ORACLE_MAX_RETRIES', '5');
    vi.stubEnv('ORACLE_ALERT_CUTOFF', '3');

    // Create service instance
    service = new OracleCallService();
    service.walletClient = mockWalletClient;
    service.publicClient = mockPublicClient;
  });

  describe('updateRaffleProbability', () => {
    it('should successfully update raffle probability', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000; // 50%

      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await service.updateRaffleProbability(fpmmAddress, probability, mockLogger);

      expect(result.success).toBe(true);
      expect(result.hash).toBe('0xhash1');
      expect(mockWalletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'updateRaffleProbability',
          args: [fpmmAddress, BigInt(probability)],
        })
      );
    });

    it('should reject invalid FPMM address', async () => {
      const result = await service.updateRaffleProbability('0x0000000000000000000000000000000000000000', 5000, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid FPMM address');
      expect(mockWalletClient.writeContract).not.toHaveBeenCalled();
    });

    it('should reject probability out of range', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      const resultTooHigh = await service.updateRaffleProbability(fpmmAddress, 10001, mockLogger);
      expect(resultTooHigh.success).toBe(false);
      expect(resultTooHigh.error).toBe('Invalid probability basis points');

      const resultNegative = await service.updateRaffleProbability(fpmmAddress, -1, mockLogger);
      expect(resultNegative.success).toBe(false);
      expect(resultNegative.error).toBe('Invalid probability basis points');
    });

    it('should retry on transient failure', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      // First call fails, second succeeds
      mockWalletClient.writeContract
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce('0xhash1');

      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await service.updateRaffleProbability(fpmmAddress, probability, mockLogger);

      expect(result.success).toBe(true);
      expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries exceeded', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      mockWalletClient.writeContract.mockRejectedValue(new Error('Persistent failure'));

      const result = await service.updateRaffleProbability(fpmmAddress, probability, mockLogger);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(5);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('updateMarketSentiment', () => {
    it('should successfully update market sentiment', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const sentiment = 6000; // 60% bullish

      mockWalletClient.writeContract.mockResolvedValue('0xhash2');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await service.updateMarketSentiment(fpmmAddress, sentiment, mockLogger);

      expect(result.success).toBe(true);
      expect(result.hash).toBe('0xhash2');
      expect(mockWalletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'updateMarketSentiment',
          args: [fpmmAddress, BigInt(sentiment)],
        })
      );
    });

    it('should reject invalid sentiment values', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      const resultTooHigh = await service.updateMarketSentiment(fpmmAddress, 10001, mockLogger);
      expect(resultTooHigh.success).toBe(false);

      const resultNegative = await service.updateMarketSentiment(fpmmAddress, -1, mockLogger);
      expect(resultNegative.success).toBe(false);
    });

    it('should handle neutral sentiment (5000)', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const sentiment = 5000; // Neutral

      mockWalletClient.writeContract.mockResolvedValue('0xhash3');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await service.updateMarketSentiment(fpmmAddress, sentiment, mockLogger);

      expect(result.success).toBe(true);
    });
  });

  describe('getPrice', () => {
    it('should retrieve current price from oracle', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      mockPublicClient.readContract = vi.fn().mockResolvedValue(BigInt(5500));

      const result = await service.getPrice(fpmmAddress, mockLogger);

      expect(result.success).toBe(true);
      expect(result.price).toBe(5500);
    });

    it('should handle price retrieval failure', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      mockPublicClient.readContract = vi.fn().mockRejectedValue(new Error('Contract call failed'));

      const result = await service.getPrice(fpmmAddress, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Exponential backoff calculation', () => {
    it('should calculate correct backoff delays', () => {
      const delays = [];
      for (let i = 1; i <= 5; i++) {
        const delay = Math.min(service.baseDelayMs * Math.pow(2, i - 1), service.maxDelayMs);
        delays.push(delay);
      }

      expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
    });

    it('should cap delay at maxDelayMs', () => {
      const delay = Math.min(service.baseDelayMs * Math.pow(2, 10), service.maxDelayMs);
      expect(delay).toBe(service.maxDelayMs);
    });
  });

  describe('Input validation', () => {
    it('should validate FPMM address format', async () => {
      const invalidAddresses = [
        '',
        '0x',
        '0xshort',
        'not-an-address',
        null,
        undefined,
      ];

      for (const addr of invalidAddresses) {
        const result = await service.updateRaffleProbability(addr, 5000, mockLogger);
        expect(result.success).toBe(false);
      }
    });

    it('should handle missing logger gracefully', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await service.updateRaffleProbability(fpmmAddress, 5000, null);

      expect(result.success).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle network errors gracefully', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      mockWalletClient.writeContract.mockRejectedValue(new Error('Network error'));

      const result = await service.updateRaffleProbability(fpmmAddress, 5000, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle contract errors', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      mockWalletClient.writeContract.mockRejectedValue(
        new Error('Contract revert: Invalid probability')
      );

      const result = await service.updateRaffleProbability(fpmmAddress, 5000, mockLogger);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid probability');
    });

    it('should handle transaction receipt failure', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' });

      const result = await service.updateRaffleProbability(fpmmAddress, 5000, mockLogger);

      expect(result.success).toBe(false);
    });
  });
});
