/**
 * @file backfillMarketTrades.js
 * @description Backfills historical Trade events from InfoFi FPMM contracts
 * Run this to populate infofi_positions table with existing trades
 */

import { publicClient } from "../lib/viemClient.js";
import { infoFiPositionService } from "../services/infoFiPositionService.js";
import simpleFpmmAbi from "../abis/SimpleFPMMAbi.js";
import { db } from "../../shared/supabaseClient.js";

const NETWORK = process.env.DEFAULT_NETWORK || "LOCAL";

async function backfillMarketTrades(fpmmAddress, fromBlock = "earliest") {
  console.log(`\n🔄 Backfilling trades for market: ${fpmmAddress}`);
  console.log(`   From block: ${fromBlock}\n`);

  try {
    // Get Trade events from contract
    const logs = await publicClient.getLogs({
      address: fpmmAddress,
      event: {
        type: "event",
        name: "Trade",
        inputs: simpleFpmmAbi.find((item) => item.name === "Trade").inputs,
      },
      fromBlock: fromBlock === "earliest" ? 0n : BigInt(fromBlock),
      toBlock: "latest",
    });

    console.log(`   Found ${logs.length} Trade events`);

    if (logs.length === 0) {
      console.log(`   ✅ No trades to backfill\n`);
      return { success: true, count: 0 };
    }

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const log of logs) {
      try {
        const { trader, buyYes, amountIn, amountOut } = log.args;

        // Record position (will skip if already exists due to tx_hash uniqueness)
        const result = await infoFiPositionService.recordPosition({
          fpmmAddress,
          trader,
          buyYes,
          amountIn,
          amountOut,
          txHash: log.transactionHash,
        });

        if (result.skipped) {
          skipCount++;
          console.log(
            `   ⏭️  Skipped (already exists): ${log.transactionHash}`
          );
        } else {
          successCount++;
          console.log(
            `   ✅ Recorded: ${trader} - ${
              buyYes ? "YES" : "NO"
            } - ${amountIn} SOF (${log.transactionHash})`
          );
        }
      } catch (error) {
        errorCount++;
        console.error(
          `   ❌ Error processing trade ${log.transactionHash}: ${error.message}`
        );
      }
    }

    console.log(`\n📊 Backfill Summary for ${fpmmAddress}:`);
    console.log(`   ✅ Recorded: ${successCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📝 Total: ${logs.length}\n`);

    return {
      success: true,
      total: logs.length,
      recorded: successCount,
      skipped: skipCount,
      errors: errorCount,
    };
  } catch (error) {
    console.error(`❌ Failed to backfill trades for ${fpmmAddress}:`, error);
    return { success: false, error: error.message };
  }
}

async function backfillAllMarkets() {
  console.log("🚀 Starting backfill of all active market trades...\n");

  try {
    // Get all active FPMM addresses
    const fpmmAddresses = await db.getActiveFpmmAddresses();

    if (!fpmmAddresses || fpmmAddresses.length === 0) {
      console.log("❌ No active markets found");
      return;
    }

    console.log(`Found ${fpmmAddresses.length} active market(s)\n`);

    const results = [];

    for (const fpmmAddress of fpmmAddresses) {
      const result = await backfillMarketTrades(fpmmAddress);
      results.push({ fpmmAddress, ...result });
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 OVERALL BACKFILL SUMMARY");
    console.log("=".repeat(60));

    let totalRecorded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const result of results) {
      if (result.success) {
        totalRecorded += result.recorded || 0;
        totalSkipped += result.skipped || 0;
        totalErrors += result.errors || 0;
      }
    }

    console.log(`Markets processed: ${results.length}`);
    console.log(`Total trades recorded: ${totalRecorded}`);
    console.log(`Total trades skipped: ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log("=".repeat(60) + "\n");

    console.log("✅ Backfill complete!");
  } catch (error) {
    console.error("❌ Backfill failed:", error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillAllMarkets()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}

export { backfillMarketTrades, backfillAllMarkets };
