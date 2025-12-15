#!/usr/bin/env node
/**
 * Scan Historical PositionUpdate Events
 * Scans blockchain for missed PositionUpdate events and creates InfoFi markets
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scanHistoricalPositionUpdates } from '../backend/src/services/bondingCurveListener.js';
import { getPublicClient } from '../backend/src/lib/viemClient.js';
import { getChainByKey } from '../backend/src/config/chain.js';
import RaffleAbi from '../backend/src/abis/RaffleAbi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env') });

const NETWORK_KEY = process.env.DEFAULT_NETWORK || 'LOCAL';
const SEASON_ID = process.env.SEASON_ID ? parseInt(process.env.SEASON_ID) : null;

// Simple console logger
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
};

async function scanHistoricalEvents() {
  console.log('🔍 Historical PositionUpdate Event Scanner\n');
  console.log(`Network: ${NETWORK_KEY}`);
  console.log(`Season ID: ${SEASON_ID || 'ALL'}\n`);

  const chain = getChainByKey(NETWORK_KEY);
  if (!chain?.raffle) {
    logger.error('No raffle address configured for network:', NETWORK_KEY);
    process.exit(1);
  }

  const client = getPublicClient(NETWORK_KEY);

  try {
    // Get current season ID if not specified
    const currentSeasonId = await client.readContract({
      address: chain.raffle,
      abi: RaffleAbi,
      functionName: 'currentSeasonId',
    });

    const currentSeasonIdNum = Number(currentSeasonId);
    logger.info(`Current season ID: ${currentSeasonIdNum}`);

    if (currentSeasonIdNum === 0) {
      logger.info('No seasons exist yet');
      return;
    }

    // Determine which seasons to scan
    const seasonsToScan = SEASON_ID ? [SEASON_ID] : Array.from({ length: currentSeasonIdNum }, (_, i) => i + 1);

    logger.info(`Scanning ${seasonsToScan.length} season(s): ${seasonsToScan.join(', ')}\n`);

    for (const seasonId of seasonsToScan) {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Processing Season ${seasonId}`);
      logger.info('='.repeat(60));

      try {
        // Get season details
        const season = await client.readContract({
          address: chain.raffle,
          abi: RaffleAbi,
          functionName: 'seasons',
          args: [BigInt(seasonId)],
        });

        // Extract bonding curve address (index 6 in the tuple)
        const bondingCurveAddr = season[6];

        if (!bondingCurveAddr || bondingCurveAddr === '0x0000000000000000000000000000000000000000') {
          logger.warn(`Season ${seasonId} has no bonding curve address, skipping`);
          continue;
        }

        logger.info(`Bonding curve address: ${bondingCurveAddr}`);

        // Get current block number
        const currentBlock = await client.getBlockNumber();
        logger.info(`Current block: ${currentBlock}`);

        // Scan from block 0 to current block
        // In production, you might want to scan from season creation block
        await scanHistoricalPositionUpdates(
          NETWORK_KEY,
          bondingCurveAddr,
          0, // fromBlock
          Number(currentBlock), // toBlock
          logger
        );

        logger.info(`✅ Completed scan for season ${seasonId}`);
      } catch (error) {
        logger.error(`Error processing season ${seasonId}:`, error.message);
      }
    }

    logger.info(`\n${'='.repeat(60)}`);
    logger.info('✅ Historical scan complete!');
    logger.info('='.repeat(60));
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the scan
scanHistoricalEvents().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
