/**
 * @file adminAlertService.js
 * @description Service for sending admin alerts when oracle calls fail
 * @date Oct 26, 2025
 *
 * Handles:
 * - Tracking failed oracle calls
 * - Sending alerts to admin channels (email, Slack, Discord)
 * - Escalation logic (alert after N consecutive failures)
 * - Alert deduplication to avoid spam
 */

/**
 * AdminAlertService - Manages admin notifications for oracle failures
 */
class AdminAlertService {
  constructor() {
    this.alertThreshold = parseInt(process.env.ORACLE_ALERT_CUTOFF || '3', 10);
    this.alertCooldown = 5 * 60 * 1000; // 5 minutes between alerts for same issue
    this.lastAlertTime = new Map(); // Track last alert time per FPMM address
    this.failureCount = new Map(); // Track consecutive failures per FPMM address
  }

  /**
   * Record an oracle call failure and potentially send alert
   * @param {string} fpmmAddress - SimpleFPMM contract address
   * @param {string} functionName - Oracle function name
   * @param {object} error - Error object
   * @param {number} attemptCount - Number of attempts made
   * @param {object} logger - Logger instance
   */
  async recordFailure(fpmmAddress, functionName, error, attemptCount, logger) {
    try {
      // Increment failure count for this FPMM
      const currentFailures = (this.failureCount.get(fpmmAddress) || 0) + 1;
      this.failureCount.set(fpmmAddress, currentFailures);

      logger.warn(
        `⚠️  Oracle failure recorded: ${fpmmAddress}, ` +
        `Function: ${functionName}, ` +
        `Failures: ${currentFailures}/${this.alertThreshold}`
      );

      // Check if we should send an alert
      if (currentFailures >= this.alertThreshold) {
        await this.sendAlert(fpmmAddress, functionName, error, attemptCount, currentFailures, logger);
      }
    } catch (alertError) {
      logger.error(`❌ Error recording oracle failure: ${alertError.message}`);
    }
  }

  /**
   * Record a successful oracle call and reset failure count
   * @param {string} fpmmAddress - SimpleFPMM contract address
   * @param {object} logger - Logger instance
   */
  recordSuccess(fpmmAddress, logger) {
    const previousFailures = this.failureCount.get(fpmmAddress) || 0;
    this.failureCount.delete(fpmmAddress);

    if (previousFailures > 0) {
      logger.info(
        `✅ Oracle recovered: ${fpmmAddress}, ` +
        `Previous failures: ${previousFailures}`
      );
    }
  }

  /**
   * Send alert to admin channels
   * @private
   * @param {string} fpmmAddress - SimpleFPMM contract address
   * @param {string} functionName - Oracle function name
   * @param {object} error - Error object
   * @param {number} attemptCount - Number of attempts made
   * @param {number} failureCount - Total consecutive failures
   * @param {object} logger - Logger instance
   */
  async sendAlert(fpmmAddress, functionName, error, attemptCount, failureCount, logger) {
    try {
      // Check cooldown to avoid alert spam
      const lastAlert = this.lastAlertTime.get(fpmmAddress);
      const now = Date.now();

      if (lastAlert && now - lastAlert < this.alertCooldown) {
        logger.debug(
          `⏳ Alert cooldown active for ${fpmmAddress}, ` +
          `next alert in ${Math.round((this.alertCooldown - (now - lastAlert)) / 1000)}s`
        );
        return;
      }

      // Update last alert time
      this.lastAlertTime.set(fpmmAddress, now);

      // Prepare alert message
      const alertMessage = {
        severity: failureCount >= this.alertThreshold * 2 ? 'CRITICAL' : 'WARNING',
        timestamp: new Date().toISOString(),
        fpmmAddress,
        functionName,
        failureCount,
        attemptCount,
        errorMessage: error?.message || String(error),
        errorCode: error?.code || 'UNKNOWN',
      };

      // Log alert
      logger.error(
        `🚨 ADMIN ALERT: Oracle call failed ${failureCount} times`,
        alertMessage
      );

      // TODO: Send to actual alert channels
      // - Email to admin
      // - Slack webhook
      // - Discord webhook
      // - PagerDuty integration
      // - Sentry/error tracking

      // For now, just log it
      await this._logAlertToDatabase(alertMessage, logger);
    } catch (alertError) {
      logger.error(`❌ Error sending alert: ${alertError.message}`);
    }
  }

  /**
   * Log alert to database for audit trail
   * @private
   * @param {object} alertMessage - Alert message object
   * @param {object} logger - Logger instance
   */
  async _logAlertToDatabase(alertMessage, logger) {
    try {
      // This would insert into an alerts table
      // For now, just log it
      logger.info(`📋 Alert logged: ${JSON.stringify(alertMessage)}`);
    } catch (error) {
      logger.error(`❌ Error logging alert to database: ${error.message}`);
    }
  }

  /**
   * Get current failure count for a FPMM address
   * @param {string} fpmmAddress - SimpleFPMM contract address
   * @returns {number} Current failure count
   */
  getFailureCount(fpmmAddress) {
    return this.failureCount.get(fpmmAddress) || 0;
  }

  /**
   * Reset failure count for a FPMM address
   * @param {string} fpmmAddress - SimpleFPMM contract address
   */
  resetFailureCount(fpmmAddress) {
    this.failureCount.delete(fpmmAddress);
  }

  /**
   * Get all FPMMs with active failures
   * @returns {Map} Map of FPMM addresses to failure counts
   */
  getActiveFailures() {
    return new Map(this.failureCount);
  }

  /**
   * Set alert threshold (for testing/configuration)
   * @param {number} threshold - New threshold
   */
  setAlertThreshold(threshold) {
    this.alertThreshold = threshold;
  }

  /**
   * Set alert cooldown (for testing/configuration)
   * @param {number} cooldownMs - New cooldown in milliseconds
   */
  setAlertCooldown(cooldownMs) {
    this.alertCooldown = cooldownMs;
  }
}

// Export singleton instance
export const adminAlertService = new AdminAlertService();

export default adminAlertService;
