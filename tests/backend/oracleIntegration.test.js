/**
 * @file oracleIntegration.test.js
 * @description Integration tests for Oracle system (OracleCallService + AdminAlertService)
 * @date Oct 30, 2025
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OracleCallService } from '../../backend/src/services/oracleCallService.js';
import { AdminAlertService } from '../../backend/src/services/adminAlertService.js';

describe('Oracle Integration Tests', () => {
  let oracleService;
  let alertService;
  let mockLogger;
  let mockWalletClient;
  let mockPublicClient;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    mockWalletClient = {
      writeContract: vi.fn(),
    };

    mockPublicClient = {
      waitForTransactionReceipt: vi.fn(),
    };

    vi.stubEnv('INFOFI_ORACLE_ADDRESS_LOCAL', '0x1234567890123456789012345678901234567890');
    vi.stubEnv('ORACLE_MAX_RETRIES', '3');
    vi.stubEnv('ORACLE_ALERT_CUTOFF', '2');

    oracleService = new OracleCallService();
    oracleService.walletClient = mockWalletClient;
    oracleService.publicClient = mockPublicClient;

    alertService = new AdminAlertService();
    alertService.setAlertThreshold(2);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Successful oracle updates', () => {
    it('should update raffle probability and track success', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);

      expect(result.success).toBe(true);

      // Record success in alert service
      alertService.recordSuccess(fpmmAddress, mockLogger);

      expect(alertService.getFailureCount(fpmmAddress)).toBe(0);
    });

    it('should update market sentiment and track success', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const sentiment = 6000;

      mockWalletClient.writeContract.mockResolvedValue('0xhash2');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await oracleService.updateMarketSentiment(fpmmAddress, sentiment, mockLogger);

      expect(result.success).toBe(true);

      alertService.recordSuccess(fpmmAddress, mockLogger);

      expect(alertService.getFailureCount(fpmmAddress)).toBe(0);
    });
  });

  describe('Failed oracle updates with alert escalation', () => {
    it('should track failures and trigger alert at threshold', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      mockWalletClient.writeContract.mockRejectedValue(new Error('Network error'));

      // First failure
      const result1 = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result1.success).toBe(false);

      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result1.error, 1, mockLogger);
      expect(alertService.getFailureCount(fpmmAddress)).toBe(1);

      // Second failure - should trigger alert
      const result2 = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result2.success).toBe(false);

      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result2.error, 2, mockLogger);
      expect(alertService.getFailureCount(fpmmAddress)).toBe(2);

      // Alert should have been triggered
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('🚨 ALERT')
      );
    });

    it('should recover from failures after success', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      // Simulate failures
      mockWalletClient.writeContract.mockRejectedValue(new Error('Error 1'));
      const result1 = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result1.error, 1, mockLogger);

      mockWalletClient.writeContract.mockRejectedValue(new Error('Error 2'));
      const result2 = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result2.error, 2, mockLogger);

      expect(alertService.getFailureCount(fpmmAddress)).toBe(2);

      // Now succeed
      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result3 = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result3.success).toBe(true);

      alertService.recordSuccess(fpmmAddress, mockLogger);

      expect(alertService.getFailureCount(fpmmAddress)).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Recovery')
      );
    });
  });

  describe('Retry mechanism with alerts', () => {
    it('should retry and eventually succeed', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      // First two attempts fail, third succeeds
      mockWalletClient.writeContract
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValueOnce('0xhash1');

      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      const result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);

      // No alert should be triggered since it eventually succeeded
      alertService.recordSuccess(fpmmAddress, mockLogger);
      expect(alertService.getFailureCount(fpmmAddress)).toBe(0);
    });

    it('should fail after max retries and trigger alert', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      mockWalletClient.writeContract.mockRejectedValue(new Error('Persistent failure'));

      const result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3); // ORACLE_MAX_RETRIES = 3

      // Track failure
      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result.error, 1, mockLogger);
      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result.error, 2, mockLogger);

      expect(alertService.getFailureCount(fpmmAddress)).toBe(2);
    });
  });

  describe('Multiple markets handling', () => {
    it('should handle updates for multiple FPMM addresses', async () => {
      const fpmm1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const fpmm2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      // Update both markets
      const result1 = await oracleService.updateRaffleProbability(fpmm1, 5000, mockLogger);
      const resultTwo = await oracleService.updateRaffleProbability(fpmm2, 6000, mockLogger);

      expect(result1.success).toBe(true);
      expect(resultTwo.success).toBe(true);

      // Both should have zero failures
      alertService.recordSuccess(fpmm1, mockLogger);
      alertService.recordSuccess(fpmm2, mockLogger);

      expect(alertService.getFailureCount(fpmm1)).toBe(0);
      expect(alertService.getFailureCount(fpmm2)).toBe(0);
    });

    it('should track failures independently per market', async () => {
      const fpmm1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const fpmm2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      // Market 1 fails
      mockWalletClient.writeContract.mockRejectedValue(new Error('Market 1 error'));
      const result1 = await oracleService.updateRaffleProbability(fpmm1, 5000, mockLogger);
      alertService.recordFailure(fpmm1, 'updateRaffleProbability', result1.error, 1, mockLogger);

      // Market 2 succeeds
      mockWalletClient.writeContract.mockResolvedValue('0xhash2');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
      const result2 = await oracleService.updateRaffleProbability(fpmm2, 6000, mockLogger);
      alertService.recordSuccess(fpmm2, mockLogger);

      expect(alertService.getFailureCount(fpmm1)).toBe(1);
      expect(alertService.getFailureCount(fpmm2)).toBe(0);
    });
  });

  describe('End-to-end flow', () => {
    it('should handle complete flow: update -> fail -> retry -> succeed -> recover', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const probability = 5000;

      // Initial successful update
      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      let result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result.success).toBe(true);
      alertService.recordSuccess(fpmmAddress, mockLogger);

      // Failure 1
      mockWalletClient.writeContract.mockRejectedValue(new Error('Network timeout'));
      result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result.success).toBe(false);
      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result.error, 1, mockLogger);

      // Failure 2 - triggers alert
      result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result.success).toBe(false);
      alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result.error, 2, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('🚨 ALERT')
      );

      // Recovery
      mockWalletClient.writeContract.mockResolvedValue('0xhash2');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      result = await oracleService.updateRaffleProbability(fpmmAddress, probability, mockLogger);
      expect(result.success).toBe(true);
      alertService.recordSuccess(fpmmAddress, mockLogger);

      expect(alertService.getFailureCount(fpmmAddress)).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Recovery')
      );
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent updates to different markets', async () => {
      const addresses = [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '0xcccccccccccccccccccccccccccccccccccccccc',
      ];

      mockWalletClient.writeContract.mockResolvedValue('0xhash1');
      mockPublicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });

      // Simulate concurrent updates
      const promises = addresses.map((addr, index) =>
        oracleService.updateRaffleProbability(addr, 5000 + index * 100, mockLogger)
      );

      const results = await Promise.all(promises);

      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // All should have zero failures
      addresses.forEach(addr => {
        alertService.recordSuccess(addr, mockLogger);
        expect(alertService.getFailureCount(addr)).toBe(0);
      });
    });
  });

  describe('Alert deduplication', () => {
    it('should not spam alerts for same market', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      alertService.setAlertCooldown(100); // 100ms cooldown

      mockWalletClient.writeContract.mockRejectedValue(new Error('Error'));

      // Multiple failures
      for (let i = 0; i < 5; i++) {
        const result = await oracleService.updateRaffleProbability(fpmmAddress, 5000, mockLogger);
        alertService.recordFailure(fpmmAddress, 'updateRaffleProbability', result.error, i + 1, mockLogger);
      }

      // Should only have one alert due to cooldown
      const alertCalls = mockLogger.error.mock.calls.filter(call =>
        call[0].includes('🚨 ALERT')
      );

      expect(alertCalls.length).toBe(1);
    });
  });
});
