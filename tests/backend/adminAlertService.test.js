/**
 * @file adminAlertService.test.js
 * @description Unit tests for AdminAlertService
 * @date Oct 30, 2025
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AdminAlertService } from '../../backend/src/services/adminAlertService.js';

describe('AdminAlertService', () => {
  let service;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    service = new AdminAlertService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Failure tracking', () => {
    it('should track consecutive failures per FPMM address', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Test error'), 1, mockLogger);

      expect(service.getFailureCount(fpmmAddress)).toBe(1);
    });

    it('should increment failure count on multiple failures', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 3'), 3, mockLogger);

      expect(service.getFailureCount(fpmmAddress)).toBe(3);
    });

    it('should track failures separately per FPMM address', () => {
      const fpmm1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const fpmm2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      service.recordFailure(fpmm1, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmm1, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);
      service.recordFailure(fpmm2, 'updateMarketSentiment', new Error('Error 3'), 1, mockLogger);

      expect(service.getFailureCount(fpmm1)).toBe(2);
      expect(service.getFailureCount(fpmm2)).toBe(1);
    });
  });

  describe('Alert triggering', () => {
    it('should trigger alert when failures reach threshold', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      service.setAlertThreshold(3);

      // First two failures - no alert
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);

      // Third failure - should trigger alert
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 3'), 3, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('🚨 ALERT')
      );
    });

    it('should not trigger alert before threshold', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      service.setAlertThreshold(5);

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);

      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('🚨 ALERT')
      );
    });

    it('should deduplicate alerts with cooldown', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      service.setAlertThreshold(1);
      service.setAlertCooldown(1000); // 1 second cooldown

      // First alert
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      const firstAlertCount = mockLogger.error.mock.calls.length;

      // Second alert immediately - should be deduplicated
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);
      const secondAlertCount = mockLogger.error.mock.calls.length;

      expect(secondAlertCount).toBe(firstAlertCount); // No new alert
    });

    it('should send alert again after cooldown expires', async () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      service.setAlertThreshold(1);
      service.setAlertCooldown(100); // 100ms cooldown

      // First alert
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      const firstAlertCount = mockLogger.error.mock.calls.length;

      // Wait for cooldown to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second alert after cooldown
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);
      const secondAlertCount = mockLogger.error.mock.calls.length;

      expect(secondAlertCount).toBeGreaterThan(firstAlertCount); // New alert sent
    });
  });

  describe('Success recovery', () => {
    it('should reset failure count on success', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);

      expect(service.getFailureCount(fpmmAddress)).toBe(2);

      service.recordSuccess(fpmmAddress, mockLogger);

      expect(service.getFailureCount(fpmmAddress)).toBe(0);
    });

    it('should log recovery message on success', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordSuccess(fpmmAddress, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('✅ Recovery')
      );
    });

    it('should not log recovery if no prior failures', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      service.recordSuccess(fpmmAddress, mockLogger);

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('✅ Recovery')
      );
    });
  });

  describe('Manual failure management', () => {
    it('should manually reset failure count', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);

      expect(service.getFailureCount(fpmmAddress)).toBe(2);

      service.resetFailureCount(fpmmAddress);

      expect(service.getFailureCount(fpmmAddress)).toBe(0);
    });

    it('should get all active failures', () => {
      const fpmm1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const fpmm2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      service.recordFailure(fpmm1, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmm1, 'updateRaffleProbability', new Error('Error 2'), 2, mockLogger);
      service.recordFailure(fpmm2, 'updateMarketSentiment', new Error('Error 3'), 1, mockLogger);

      const activeFailures = service.getActiveFailures();

      expect(activeFailures).toHaveLength(2);
      expect(activeFailures).toContainEqual(
        expect.objectContaining({ fpmmAddress: fpmm1, failureCount: 2 })
      );
      expect(activeFailures).toContainEqual(
        expect.objectContaining({ fpmmAddress: fpmm2, failureCount: 1 })
      );
    });
  });

  describe('Configuration', () => {
    it('should allow setting alert threshold', () => {
      service.setAlertThreshold(5);
      expect(service.alertThreshold).toBe(5);
    });

    it('should allow setting alert cooldown', () => {
      service.setAlertCooldown(2000);
      expect(service.alertCooldown).toBe(2000);
    });

    it('should use default threshold if not set', () => {
      const newService = new AdminAlertService();
      expect(newService.alertThreshold).toBe(3);
    });

    it('should use default cooldown if not set', () => {
      const newService = new AdminAlertService();
      expect(newService.alertCooldown).toBe(5 * 60 * 1000); // 5 minutes
    });
  });

  describe('Error handling', () => {
    it('should handle missing logger gracefully', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      expect(() => {
        service.recordFailure(fpmmAddress, 'updateRaffleProbability', new Error('Test error'), 1, null);
      }).not.toThrow();
    });

    it('should handle null FPMM address gracefully', () => {
      expect(() => {
        service.recordFailure(null, 'updateRaffleProbability', new Error('Test error'), 1, mockLogger);
      }).not.toThrow();
    });

    it('should track error details in failure record', () => {
      const fpmmAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const error = new Error('Specific error message');

      service.recordFailure(fpmmAddress, 'updateRaffleProbability', error, 1, mockLogger);

      const failures = service.getActiveFailures();
      expect(failures[0]).toHaveProperty('lastError');
    });
  });

  describe('Multiple FPMM addresses', () => {
    it('should handle multiple FPMM addresses independently', () => {
      const addresses = [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '0xcccccccccccccccccccccccccccccccccccccccc',
      ];

      addresses.forEach((addr, index) => {
        for (let i = 0; i <= index; i++) {
          service.recordFailure(addr, 'updateRaffleProbability', new Error(`Error ${i}`), i + 1, mockLogger);
        }
      });

      expect(service.getFailureCount(addresses[0])).toBe(1);
      expect(service.getFailureCount(addresses[1])).toBe(2);
      expect(service.getFailureCount(addresses[2])).toBe(3);
    });

    it('should reset only specified FPMM address', () => {
      const fpmm1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const fpmm2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      service.recordFailure(fpmm1, 'updateRaffleProbability', new Error('Error 1'), 1, mockLogger);
      service.recordFailure(fpmm2, 'updateRaffleProbability', new Error('Error 2'), 1, mockLogger);

      service.resetFailureCount(fpmm1);

      expect(service.getFailureCount(fpmm1)).toBe(0);
      expect(service.getFailureCount(fpmm2)).toBe(1);
    });
  });
});
