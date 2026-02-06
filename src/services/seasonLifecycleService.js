/**
 * @file seasonLifecycleService.js
 * @description Automated season lifecycle management - starts and ends seasons on schedule
 * 
 * Checks every 5 minutes for:
 * - Seasons where startTime has passed but status is NotStarted → calls startSeason()
 * - Seasons where endTime has passed but status is Active → calls requestSeasonEnd()
 * 
 * @author SecondOrder.fun
 */

import { publicClient, getWalletClient } from "../lib/viemClient.js";
import RaffleAbi from "../abis/RaffleAbi.js";
import { adminAlertService } from "./adminAlertService.js";

// SeasonStatus enum from contract
const SeasonStatus = {
  NotStarted: 0,
  Active: 1,
  EndRequested: 2,
  VRFPending: 3,
  Distributing: 4,
  Completed: 5,
};

const STATUS_NAMES = [
  "NotStarted",
  "Active",
  "EndRequested",
  "VRFPending",
  "Distributing",
  "Completed",
];

// Default check interval: 5 minutes
const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * SeasonLifecycleService - Manages automatic season starts and ends
 */
export class SeasonLifecycleService {
  constructor(logger) {
    this.logger = logger;
    this.raffleAddress = null;
    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Initialize the service
   * @param {string} raffleAddress - Raffle contract address
   */
  async initialize(raffleAddress) {
    this.raffleAddress = raffleAddress;

    if (!this.raffleAddress) {
      throw new Error("RAFFLE_ADDRESS not provided");
    }

    this.logger.info("🔄 SeasonLifecycleService initialized");
    this.logger.info(`   Raffle: ${this.raffleAddress}`);
  }

  /**
   * Start the periodic lifecycle check
   * @param {number} intervalMs - Check interval in milliseconds
   */
  start(intervalMs = DEFAULT_CHECK_INTERVAL_MS) {
    if (this.intervalId) {
      this.logger.warn("SeasonLifecycleService already running");
      return;
    }

    this.logger.info(
      `🚀 Starting SeasonLifecycleService (interval: ${intervalMs / 1000}s)`
    );

    // Run immediately on start
    this.checkAndProcessSeasons();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.checkAndProcessSeasons();
    }, intervalMs);
  }

  /**
   * Stop the periodic lifecycle check
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info("⏹️ SeasonLifecycleService stopped");
    }
  }

  /**
   * Check all seasons and process any that need state transitions
   */
  async checkAndProcessSeasons() {
    if (this.isRunning) {
      this.logger.debug("SeasonLifecycleService check already in progress, skipping");
      return;
    }

    this.isRunning = true;

    try {
      // Get current season count
      const currentSeasonId = await publicClient.readContract({
        address: this.raffleAddress,
        abi: RaffleAbi,
        functionName: "currentSeasonId",
      });

      if (currentSeasonId === 0n) {
        this.logger.debug("No seasons exist yet");
        this.isRunning = false;
        return;
      }

      const now = BigInt(Math.floor(Date.now() / 1000));

      // Check each season
      for (let seasonId = 1n; seasonId <= currentSeasonId; seasonId++) {
        await this.processSeasonIfNeeded(seasonId, now);
      }
    } catch (error) {
      this.logger.error(`❌ SeasonLifecycleService check failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single season if it needs a state transition
   * @param {bigint} seasonId 
   * @param {bigint} now - Current timestamp
   */
  async processSeasonIfNeeded(seasonId, now) {
    try {
      const details = await publicClient.readContract({
        address: this.raffleAddress,
        abi: RaffleAbi,
        functionName: "getSeasonDetails",
        args: [seasonId],
      });

      // Destructure the tuple: [config, status, totalParticipants, totalTickets, totalPrizePool]
      const [config, status] = details;
      const { name, startTime, endTime } = config;
      const statusNum = Number(status);

      this.logger.debug(
        `Season ${seasonId} "${name}": status=${STATUS_NAMES[statusNum]}, ` +
        `startTime=${startTime}, endTime=${endTime}, now=${now}`
      );

      // Check if season needs to be STARTED
      if (
        statusNum === SeasonStatus.NotStarted &&
        now >= startTime &&
        now < endTime
      ) {
        await this.startSeason(seasonId, name);
        return;
      }

      // Check if season needs END REQUESTED
      if (statusNum === SeasonStatus.Active && now >= endTime) {
        await this.requestSeasonEnd(seasonId, name);
        return;
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to process season ${seasonId}: ${error.message}`
      );
    }
  }

  /**
   * Call startSeason on the contract
   * @param {bigint} seasonId 
   * @param {string} seasonName 
   */
  async startSeason(seasonId, seasonName) {
    this.logger.info(`🎬 Starting season ${seasonId} "${seasonName}"...`);

    try {
      const walletClient = getWalletClient();

      const hash = await walletClient.writeContract({
        address: this.raffleAddress,
        abi: RaffleAbi,
        functionName: "startSeason",
        args: [seasonId],
      });

      this.logger.info(`✅ Season ${seasonId} started! TX: ${hash}`);

      // Send Telegram alert
      await this.sendAlert(
        `🎬 Season ${seasonId} "${seasonName}" has been automatically started!\n\nTX: ${hash}`
      );
    } catch (error) {
      this.logger.error(`❌ Failed to start season ${seasonId}: ${error.message}`);
      
      await this.sendAlert(
        `❌ Failed to auto-start season ${seasonId} "${seasonName}"\n\nError: ${error.message}`
      );
    }
  }

  /**
   * Call requestSeasonEnd on the contract
   * @param {bigint} seasonId 
   * @param {string} seasonName 
   */
  async requestSeasonEnd(seasonId, seasonName) {
    this.logger.info(`🏁 Requesting end for season ${seasonId} "${seasonName}"...`);

    try {
      const walletClient = getWalletClient();

      const hash = await walletClient.writeContract({
        address: this.raffleAddress,
        abi: RaffleAbi,
        functionName: "requestSeasonEnd",
        args: [seasonId],
      });

      this.logger.info(`✅ Season ${seasonId} end requested! TX: ${hash}`);

      // Send Telegram alert
      await this.sendAlert(
        `🏁 Season ${seasonId} "${seasonName}" end requested! VRF pending for winner selection.\n\nTX: ${hash}`
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to request end for season ${seasonId}: ${error.message}`
      );

      await this.sendAlert(
        `❌ Failed to auto-end season ${seasonId} "${seasonName}"\n\nError: ${error.message}`
      );
    }
  }

  /**
   * Send alert via adminAlertService if available
   * @param {string} message 
   */
  async sendAlert(message) {
    try {
      if (adminAlertService && typeof adminAlertService.sendAlert === "function") {
        await adminAlertService.sendAlert(message);
      }
    } catch (error) {
      this.logger.warn(`Failed to send alert: ${error.message}`);
    }
  }
}

// Singleton instance
let seasonLifecycleService = null;

/**
 * Get or create the SeasonLifecycleService instance
 * @param {object} logger 
 * @returns {SeasonLifecycleService}
 */
export function getSeasonLifecycleService(logger) {
  if (!seasonLifecycleService) {
    seasonLifecycleService = new SeasonLifecycleService(logger);
  }
  return seasonLifecycleService;
}

/**
 * Start the season lifecycle service
 * @param {string} raffleAddress - Raffle contract address
 * @param {object} logger - Logger instance
 * @param {number} intervalMs - Check interval (default 5 min)
 */
export async function startSeasonLifecycleService(
  raffleAddress,
  logger,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS
) {
  const service = getSeasonLifecycleService(logger);
  await service.initialize(raffleAddress);
  service.start(intervalMs);
  return service;
}
