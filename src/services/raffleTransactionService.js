import { publicClient } from "../lib/viemClient.js";
import { db } from "../../shared/supabaseClient.js";
import { queryLogsInChunks } from "../utils/blockRangeQuery.js";
import SOFBondingCurveAbi from "../abis/SOFBondingCurveAbi.js";

/**
 * Service for recording and querying raffle transaction history
 * Implements event sourcing pattern with partitioned storage
 */
class RaffleTransactionService {
  /**
   * Record a transaction from PositionUpdate event (idempotent via tx_hash)
   */
  async recordTransaction({
    seasonId,
    userAddress,
    transactionType,
    ticketAmount,
    sofAmount,
    txHash,
    blockNumber,
    blockTimestamp,
    ticketsBefore,
    ticketsAfter,
  }) {
    try {
      // Calculate price per ticket
      const pricePerTicket =
        ticketAmount !== 0 ? Math.abs(sofAmount / ticketAmount) : null;

      const { data, error } = await db.client
        .from("raffle_transactions")
        .insert({
          season_id: seasonId,
          user_address: userAddress,
          transaction_type: transactionType,
          ticket_amount: ticketAmount,
          sof_amount: sofAmount,
          price_per_ticket: pricePerTicket,
          tx_hash: txHash,
          block_number: blockNumber,
          block_timestamp: blockTimestamp,
          tickets_before: ticketsBefore,
          tickets_after: ticketsAfter,
        })
        .select()
        .single();

      if (error) {
        // Check if duplicate (idempotency)
        if (error.code === "23505") {
          // Unique constraint violation on tx_hash
          return { alreadyRecorded: true, txHash };
        }
        throw error;
      }

      return { success: true, data };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to record raffle transaction:", error);
      throw error;
    }
  }

  /**
   * Sync historical transactions for a season from blockchain
   */
  async syncSeasonTransactions(
    seasonId,
    bondingCurveAddress,
    fromBlock = null
  ) {
    try {
      // Get season's last synced block
      const { data: season } = await db.client
        .from("season_contracts")
        .select("created_at, last_tx_sync_block")
        .eq("season_id", seasonId)
        .single();

      if (!season) {
        return { error: "Season not found", seasonId };
      }

      const startBlock =
        fromBlock !== null
          ? BigInt(fromBlock)
          : BigInt(season.last_tx_sync_block || 0);

      const latestBlock = await publicClient.getBlockNumber();

      if (startBlock >= latestBlock) {
        return {
          success: true,
          recorded: 0,
          message: "Already up to date",
        };
      }

      // Get PositionUpdate event definition
      const positionUpdateEvent = SOFBondingCurveAbi.find(
        (item) => item.type === "event" && item.name === "PositionUpdate"
      );

      if (!positionUpdateEvent) {
        throw new Error("PositionUpdate event not found in ABI");
      }

      // Fetch events in chunks
      const logs = await queryLogsInChunks(
        publicClient,
        {
          address: bondingCurveAddress,
          event: {
            type: "event",
            name: "PositionUpdate",
            inputs: positionUpdateEvent.inputs,
          },
          fromBlock: startBlock,
          toBlock: latestBlock,
        },
        10000n // 10k block chunks
      );

      // Filter logs for this season
      const seasonLogs = logs.filter(
        (log) => Number(log.args.seasonId) === seasonId
      );

      let recorded = 0;
      let skipped = 0;
      let errors = 0;

      for (const log of seasonLogs) {
        const { player, oldTickets, newTickets } = log.args;

        try {
          // Get block timestamp
          const block = await publicClient.getBlock({
            blockNumber: log.blockNumber,
          });

          // Determine transaction type and amounts
          const oldTicketsNum = Number(oldTickets);
          const newTicketsNum = Number(newTickets);
          const ticketDelta = newTicketsNum - oldTicketsNum;
          const transactionType = ticketDelta > 0 ? "BUY" : "SELL";

          // Get transaction to extract SOF amount
          const tx = await publicClient.getTransaction({
            hash: log.transactionHash,
          });

          // Convert wei to SOF (18 decimals)
          const sofAmount = Number(tx.value) / 1e18;

          const result = await this.recordTransaction({
            seasonId,
            userAddress: player,
            transactionType,
            ticketAmount: Math.abs(ticketDelta),
            sofAmount,
            txHash: log.transactionHash,
            blockNumber: Number(log.blockNumber),
            blockTimestamp: new Date(
              Number(block.timestamp) * 1000
            ).toISOString(),
            ticketsBefore: oldTicketsNum,
            ticketsAfter: newTicketsNum,
          });

          if (result.alreadyRecorded) {
            skipped++;
          } else {
            recorded++;
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(
            `Failed to record tx ${log.transactionHash}:`,
            error.message
          );
          errors++;
        }
      }

      // Update last synced block
      await db.client
        .from("season_contracts")
        .update({
          last_tx_sync_block: latestBlock.toString(),
        })
        .eq("season_id", seasonId);

      // Refresh materialized view
      await this.refreshUserPositions(seasonId);

      return {
        success: true,
        recorded,
        skipped,
        errors,
        totalEvents: seasonLogs.length,
        fromBlock: startBlock.toString(),
        toBlock: latestBlock.toString(),
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error syncing season transactions:", error);
      throw error;
    }
  }

  /**
   * Sync all active seasons
   */
  async syncAllActiveSeasons(bondingCurveAddress) {
    const { data: seasons } = await db.client
      .from("season_contracts")
      .select("season_id, bonding_curve_address")
      .eq("is_active", true);

    const results = [];
    for (const season of seasons || []) {
      const curveAddress = season.bonding_curve_address || bondingCurveAddress;
      const result = await this.syncSeasonTransactions(
        season.season_id,
        curveAddress
      );
      results.push({ seasonId: season.season_id, ...result });
    }

    return results;
  }

  /**
   * Get user's transaction history for a season
   */
  async getUserTransactions(userAddress, seasonId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy = "block_timestamp",
      order = "desc",
    } = options;

    const { data, error } = await db.client
      .from("raffle_transactions")
      .select("*")
      .eq("user_address", userAddress)
      .eq("season_id", seasonId)
      .order(orderBy, { ascending: order === "asc" })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data;
  }

  /**
   * Get user's aggregated position for a season
   */
  async getUserPosition(userAddress, seasonId) {
    const { data, error } = await db.client
      .from("user_raffle_positions")
      .select("*")
      .eq("user_address", userAddress)
      .eq("season_id", seasonId)
      .single();

    if (error && error.code !== "PGRST116") throw error; // Ignore "not found"
    return data;
  }

  /**
   * Get user's positions across all seasons
   */
  async getAllUserPositions(userAddress) {
    const { data, error } = await db.client
      .from("user_raffle_positions")
      .select("*")
      .eq("user_address", userAddress)
      .order("season_id", { ascending: false });

    if (error) throw error;
    return data;
  }

  /**
   * Refresh materialized view
   */
  async refreshUserPositions(seasonId = null) {
    try {
      const { error } = await db.client.rpc("refresh_user_positions", {
        season_num: seasonId,
      });

      if (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to refresh user positions:", error);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Error calling refresh_user_positions:", error);
    }
  }
}

export const raffleTransactionService = new RaffleTransactionService();
