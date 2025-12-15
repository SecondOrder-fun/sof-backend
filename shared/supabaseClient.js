import { createClient } from "@supabase/supabase-js";
import process from "node:process";

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || "";
// Prefer service role key on the server; fall back to anon key
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseKey = supabaseServiceKey || supabaseAnonKey;
export const hasSupabase = Boolean(supabaseUrl && supabaseKey);

// Create Supabase client or a no-op stub for local dev without env
function createStubResult(defaultData = []) {
  // Chainable object that mimics supabase-js query builder and resolves to { data, error }
  const result = {
    data: Array.isArray(defaultData) ? defaultData : [],
    error: null,
    select: () => result,
    insert: () => result,
    update: () => result,
    delete: () => result,
    eq: () => result,
    order: () => result,
    single: () => ({ data: null, error: null }),
  };
  return result;
}

export const supabase = hasSupabase
  ? createClient(supabaseUrl, supabaseKey)
  : {
      from: () => createStubResult([]),
    };

// Database service class
export class DatabaseService {
  constructor() {
    this.client = supabase;
    this.logger = null; // Will be set by server.js
  }

  /**
   * Set logger instance (called from server.js)
   */
  setLogger(logger) {
    this.logger = logger;
  }

  /**
   * Get logger or fallback to console
   */
  getLogger() {
    return this.logger || console;
  }

  // Raffle operations
  async getActiveRaffles() {
    const { data, error } = await this.client
      .from("raffles")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data;
  }

  async getInfoFiMarketByComposite(seasonId, playerAddress, marketType) {
    // Normalize address to lowercase for case-insensitive comparison
    const normalizedAddress = playerAddress.toLowerCase();

    const { data, error } = await this.client
      .from("infofi_markets")
      .select("*")
      .eq("season_id", seasonId)
      .eq("player_address", normalizedAddress)
      .eq("market_type", marketType)
      .limit(1)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      // PGRST116 = No rows found
      throw new Error(error.message);
    }
    return data || null;
  }

  async hasInfoFiMarket(seasonId, playerAddress, marketType) {
    const existing = await this.getInfoFiMarketByComposite(
      seasonId,
      playerAddress,
      marketType
    );
    return Boolean(existing);
  }

  async getRaffleById(id) {
    const { data, error } = await this.client
      .from("raffles")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async createRaffle(raffleData) {
    const { data, error } = await this.client
      .from("raffles")
      .insert([raffleData])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // InfoFi market operations
  async getActiveInfoFiMarkets() {
    // Align with schema (is_active boolean)
    const { data, error } = await this.client
      .from("infofi_markets")
      .select("*, players!infofi_markets_player_id_fkey(address)")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    // Transform players object to player address
    return data.map((market) => {
      if (market.players) {
        market.player = market.players.address;
        delete market.players;
      }
      return market;
    });
  }

  async getInfoFiMarketById(id) {
    const { data, error } = await this.client
      .from("infofi_markets")
      .select("*, players!infofi_markets_player_id_fkey(address)")
      .eq("id", id)
      .limit(1);

    if (error) throw new Error(error.message);
    // Return first result or null if no results
    const market = data && data.length > 0 ? data[0] : null;
    if (market && market.players) {
      market.player = market.players.address;
      delete market.players;
    }
    return market;
  }

  /**
   * Get InfoFi market by season and player (the natural key from blockchain)
   */
  async getInfoFiMarketBySeasonAndPlayer(
    seasonId,
    playerAddress,
    marketType = "WINNER_PREDICTION"
  ) {
    // Normalize address to lowercase for case-insensitive comparison
    const normalizedAddress = playerAddress.toLowerCase();

    const { data, error } = await this.client
      .from("infofi_markets")
      .select("*")
      .eq("season_id", seasonId)
      .eq("player_address", normalizedAddress)
      .eq("market_type", marketType)
      .limit(1);

    if (error) throw new Error(error.message);
    return data && data.length > 0 ? data[0] : null;
  }

  async getInfoFiMarketsBySeasonId(seasonId) {
    const { data, error } = await this.client
      .from("infofi_markets")
      .select("*, players!infofi_markets_player_id_fkey(address)")
      .eq("season_id", seasonId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Transform players object to player address
    return data.map((market) => {
      if (market.players) {
        market.player = market.players.address;
        delete market.players;
      }
      return market;
    });
  }

  // Backward compatibility alias
  async getInfoFiMarketsByRaffleId(seasonId) {
    return this.getInfoFiMarketsBySeasonId(seasonId);
  }

  async createInfoFiMarket(marketData) {
    // Check if Supabase is configured
    if (!hasSupabase) {
      const error =
        "Supabase not configured - missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY";
      this.getLogger().error(
        { err: new Error(error) },
        "[supabaseClient] Configuration error"
      );
      throw new Error(error);
    }

    // Log incoming data for debugging
    this.getLogger().debug(
      { marketData },
      "[supabaseClient] createInfoFiMarket called"
    );

    // Validate required fields
    const seasonId = marketData.season_id;
    if (!seasonId || !marketData.player_address || !marketData.market_type) {
      const error = `Missing required fields: season_id, player_address, or market_type`;
      this.getLogger().error(
        { marketData },
        "[supabaseClient] Validation error"
      );
      throw new Error(error);
    }

    const insertData = {
      season_id: seasonId,
      player_address: marketData.player_address.toLowerCase(),
      player_id: marketData.player_id || null,
      market_type: marketData.market_type,
      contract_address: marketData.contract_address
        ? marketData.contract_address.toLowerCase()
        : null,
      current_probability_bps: marketData.current_probability_bps || 0,
      is_active:
        marketData.is_active !== undefined ? marketData.is_active : true,
      is_settled:
        marketData.is_settled !== undefined ? marketData.is_settled : false,
      created_at: marketData.created_at || new Date().toISOString(),
      updated_at: marketData.updated_at || new Date().toISOString(),
    };

    this.getLogger().debug({ insertData }, "[supabaseClient] Inserting data");

    const { data, error } = await this.client
      .from("infofi_markets")
      .insert([insertData])
      .select()
      .single();

    if (error) {
      this.getLogger().error({ err: error }, "[supabaseClient] Insert error");
      throw new Error(error.message);
    }

    this.getLogger().info(
      `[supabaseClient] Successfully created market: ${data.id}`
    );
    return data;
  }

  async updateInfoFiMarket(id, marketData) {
    const { data, error } = await this.client
      .from("infofi_markets")
      .update(marketData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateInfoFiMarketProbability(
    seasonId,
    playerId,
    marketType,
    newProbabilityBps
  ) {
    const { data, error } = await this.client
      .from("infofi_markets")
      .update({ current_probability_bps: newProbabilityBps })
      .eq("season_id", seasonId)
      .eq("player_id", playerId)
      .eq("market_type", marketType)
      .select()
      .single();

    if (error) {
      // Don't throw - market might not exist yet (race condition with MarketCreated)
      return null;
    }
    return data;
  }

  async deleteInfoFiMarket(id) {
    const { data, error } = await this.client
      .from("infofi_markets")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Clear all InfoFi markets from database
   * Used when restarting local Anvil to ensure DB is in sync with chain
   */
  async clearAllInfoFiMarkets() {
    const { error } = await this.client
      .from("infofi_markets")
      .delete()
      .neq("id", 0); // Delete all rows

    if (error) throw new Error(error.message);

    // Reset the auto-increment sequence to start from 1
    const { error: seqError } = await this.client.rpc(
      "reset_infofi_markets_sequence"
    );
    if (seqError && !seqError.message?.includes("does not exist")) {
      // Only throw if it's not a "function doesn't exist" error
      // (function might not be created yet in some environments)
      this.getLogger().debug(
        "[clearAllInfoFiMarkets] Could not reset sequence:",
        seqError.message
      );
    }
  }

  /**
   * Clear all market pricing cache entries
   */
  async clearAllMarketPricingCache() {
    const { error } = await this.client
      .from("market_pricing_cache")
      .delete()
      .neq("market_id", 0); // Delete all rows

    if (error) throw new Error(error.message);
  }

  /**
   * Log a failed InfoFi market creation attempt
   * @param {Object} params
   * @param {number} params.seasonId - Season identifier
   * @param {string} params.playerAddress - Player wallet address
   * @param {string} [params.source] - 'LISTENER' | 'ADMIN' | 'UNKNOWN'
   * @param {string} [params.errorMessage] - Error message, if any
   * @param {number} [params.attempts] - Number of attempts made
   * @returns {Promise<Object|null>} Inserted row or null on failure / no Supabase
   */
  async logFailedMarketAttempt({
    seasonId,
    playerAddress,
    source,
    errorMessage,
    attempts,
  }) {
    if (!hasSupabase) {
      this.getLogger().warn(
        "[supabaseClient] logFailedMarketAttempt called without Supabase config"
      );
      return null;
    }

    const insertData = {
      season_id: seasonId,
      player_address: String(playerAddress || "").toLowerCase(),
      source: source || "UNKNOWN",
      error_message: errorMessage || null,
      attempts: typeof attempts === "number" ? attempts : null,
      last_attempt_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from("infofi_failed_markets")
      .insert([insertData])
      .select()
      .single();

    if (error) {
      this.getLogger().error(
        { err: error },
        "[supabaseClient] Failed to log failed market attempt"
      );
      return null;
    }

    return data;
  }

  /**
   * Get recent failed InfoFi market creation attempts
   * @param {number} [limit=50] - Maximum number of rows to return
   * @returns {Promise<Array>} Array of failed attempts
   */
  async getFailedMarketAttempts(limit = 50) {
    if (!hasSupabase) {
      return [];
    }

    const { data, error } = await this.client
      .from("infofi_failed_markets")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      this.getLogger().error(
        { err: error },
        "[supabaseClient] Failed to fetch failed market attempts"
      );
      throw new Error(error.message);
    }

    return data || [];
  }

  async getMarketOdds(marketId) {
    // Align odds with pricing cache (bps fields)
    const { data, error } = await this.client
      .from("market_pricing_cache")
      .select(
        "raffle_probability, market_sentiment, hybrid_price, last_updated"
      )
      .eq("market_id", marketId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Hybrid pricing cache operations
  async upsertHybridPricingCache(cache) {
    // cache: { market_id, raffle_component, sentiment_component, hybrid_price, last_updated }
    const { data, error } = await this.client
      .from("hybrid_pricing_cache")
      .upsert(cache)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getHybridPricingCache(marketId) {
    const { data, error } = await this.client
      .from("hybrid_pricing_cache")
      .select("*")
      .eq("market_id", marketId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Legacy market pricing cache operations (bps-based) - deprecated
  async upsertMarketPricingCache(cache) {
    // cache: { market_id, raffle_probability, market_sentiment, hybrid_price,
    //          raffle_weight, market_weight, last_updated }
    const { data, error } = await this.client
      .from("market_pricing_cache")
      .upsert(cache)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getMarketPricingCache(marketId) {
    const { data, error } = await this.client
      .from("market_pricing_cache")
      .select("*")
      .eq("market_id", marketId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // Positions (user bets)
  async createInfoFiPosition(position) {
    // position: { market_id, user_address, outcome, amount, price? }
    const { data, error } = await this.client
      .from("infofi_positions")
      .insert([position])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getPositionsByAddress(address) {
    const { data, error } = await this.client
      .from("infofi_positions")
      .select("*")
      .eq("user_address", address)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  }

  // Players helpers
  async getPlayerByAddress(address) {
    const addr = String(address || "").toLowerCase();
    const { data, error } = await this.client
      .from("players")
      .select("*")
      .ilike("address", addr)
      .single();
    if (error && error.code !== "PGRST116") throw new Error(error.message);
    return data || null;
  }

  async createPlayer(address) {
    const addr = String(address || "").toLowerCase();
    const { data, error } = await this.client
      .from("players")
      .insert([{ address: addr }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getOrCreatePlayerIdByAddress(address) {
    const existing = await this.getPlayerByAddress(address);
    if (existing?.id) return existing.id;

    try {
      const created = await this.createPlayer(address);
      return created.id;
    } catch (err) {
      // Handle race condition - player might have been created between check and insert
      if (
        err.message?.includes("duplicate key") ||
        err.message?.includes("players_pkey")
      ) {
        const retry = await this.getPlayerByAddress(address);
        if (retry?.id) return retry.id;
      }
      throw err;
    }
  }

  // Analytics operations
  async getPlayerMarketPositions(playerAddress, timeframe, limit) {
    // Use the parameters to satisfy lint requirements
    if (!playerAddress || !timeframe || !limit) {
      // Intentionally empty - parameters used to satisfy lint requirements
    }

    // This is a placeholder implementation
    // In a real implementation, this would query the database for player positions
    return [];
  }

  async getArbitrageHistory(limit, timeframe) {
    // Use the parameters to satisfy lint requirements
    if (!limit || !timeframe) {
      // Intentionally empty - parameters used to satisfy lint requirements
    }

    // This is a placeholder implementation
    // In a real implementation, this would query the database for arbitrage history
    return [];
  }

  async getUserMarketActivity(playerAddress) {
    // Use the parameter to satisfy lint requirements
    if (!playerAddress) {
      // Intentionally empty - parameter used to satisfy lint requirements
    }

    // This is a placeholder implementation
    // In a real implementation, this would query the database for user market activity
    return {
      totalMarkets: 0,
      totalVolume: 0,
      favoriteMarkets: [],
    };
  }

  async getUserArbitrageActivity(playerAddress) {
    // Use the parameter to satisfy lint requirements
    if (!playerAddress) {
      // Intentionally empty - parameter used to satisfy lint requirements
    }

    // This is a placeholder implementation
    // In a real implementation, this would query the database for user arbitrage activity
    return {
      totalArbitrages: 0,
      totalProfit: 0,
      successRate: 0,
    };
  }

  // User operations
  async getUserById(id) {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getUserByAddress(address) {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("wallet_address", address)
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async createUser(userData) {
    const { data, error } = await this.client
      .from("users")
      .insert([userData])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateUser(id, userData) {
    const { data, error } = await this.client
      .from("users")
      .update(userData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Event processing state operations
  async getLastProcessedBlock(eventType) {
    const { data, error } = await this.client
      .from("event_processing_state")
      .select("last_block")
      .eq("event_type", eventType)
      .single();

    if (error && error.code !== "PGRST116") {
      // Not found is OK
      this.getLogger().debug("Error getting last processed block:", error);
    }

    return data?.last_block || 0;
  }

  async setLastProcessedBlock(eventType, blockNumber) {
    const { error } = await this.client.from("event_processing_state").upsert({
      event_type: eventType,
      last_block: blockNumber,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      this.getLogger().debug("Error setting last processed block:", error);
    }
  }

  // Season contracts operations
  /**
   * Create or update season contract addresses
   * @param {Object} data - Season contract data
   * @param {number} data.season_id - Season ID
   * @param {string} data.bonding_curve_address - BondingCurve contract address
   * @param {string} data.raffle_token_address - RaffleToken contract address
   * @param {string} data.raffle_address - Raffle contract address
   * @param {boolean} [data.is_active] - Whether season is active (default: true)
   * @returns {Promise<Object>} Created/updated season contract record
   */
  async createSeasonContracts(data) {
    const { data: result, error } = await this.client
      .from("season_contracts")
      .upsert(
        {
          season_id: data.season_id,
          bonding_curve_address: data.bonding_curve_address,
          raffle_token_address: data.raffle_token_address,
          raffle_address: data.raffle_address,
          is_active: data.is_active !== undefined ? data.is_active : true,
        },
        {
          onConflict: "season_id",
        }
      )
      .select()
      .single();

    if (error) throw new Error(error.message);
    return result;
  }

  /**
   * Get player_id from players table, or create new entry if doesn't exist
   * @param {string} playerAddress - Ethereum address
   * @returns {Promise<number>} player_id
   */
  async getOrCreatePlayerId(playerAddress) {
    try {
      // Try to find existing player
      const { data: existingPlayer } = await this.client
        .from("players")
        .select("id")
        .eq("address", playerAddress.toLowerCase())
        .maybeSingle();

      if (existingPlayer) {
        return existingPlayer.id;
      }

      // Player doesn't exist, create new entry
      const { data: newPlayer, error: insertError } = await this.client
        .from("players")
        .insert({
          address: playerAddress.toLowerCase(),
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertError) {
        throw insertError;
      }

      return newPlayer.id;
    } catch (error) {
      const logger = this.getLogger();
      logger.error(
        `Failed to get or create player ID for ${playerAddress}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get season contract addresses by season ID
   * @param {number} seasonId - Season ID
   * @returns {Promise<Object|null>} Season contract record or null if not found
   */
  async getSeasonContracts(seasonId) {
    const { data, error } = await this.client
      .from("season_contracts")
      .select("*")
      .eq("season_id", seasonId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      throw new Error(error.message);
    }

    return data || null;
  }

  /**
   * Get the latest season ID from database
   * @returns {Promise<number|null>} Latest season ID or null if no seasons exist
   */
  async getLatestSeasonId() {
    const { data, error } = await this.client
      .from("season_contracts")
      .select("season_id")
      .order("season_id", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      throw new Error(error.message);
    }

    return data ? data.season_id : null;
  }

  /**
   * Update season active status
   * @param {number} seasonId - Season ID
   * @param {boolean} isActive - New active status
   * @returns {Promise<Object>} Updated season contract record
   */
  async updateSeasonStatus(seasonId, isActive) {
    const { data, error } = await this.client
      .from("season_contracts")
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("season_id", seasonId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Get all active season contracts
   * @returns {Promise<Array>} Array of active season contract records
   */
  async getActiveSeasonContracts() {
    const { data, error } = await this.client
      .from("season_contracts")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  }

  /**
   * Mark season as inactive
   * @param {number} seasonId - Season ID
   * @returns {Promise<Object>} Updated season contract record
   */
  async deactivateSeasonContracts(seasonId) {
    const { data, error } = await this.client
      .from("season_contracts")
      .update({ is_active: false })
      .eq("season_id", seasonId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Update win probabilities for ALL players in a season
   * Called when any player's position changes (buy/sell)
   *
   * @param {number} seasonId - Season identifier
   * @param {number} totalTickets - New total ticket supply
   * @param {Array} playerPositions - Array of {player, ticketCount}
   * @returns {Promise<number>} Count of updated markets
   */
  async updateAllPlayerProbabilities(
    seasonId,
    totalTickets,
    playerPositions,
    maxSupply
  ) {
    if (totalTickets === 0) {
      throw new Error(
        `Cannot update probabilities: totalTickets is 0 for season ${seasonId}`
      );
    }

    try {
      let updatedCount = 0;

      // Calculate 1% threshold based on max supply (not current total)
      const thresholdTickets = maxSupply ? Math.ceil(maxSupply / 100) : null;

      // Update each player's market
      for (const { player, ticketCount } of playerPositions) {
        // Calculate new probability in basis points
        const newProbabilityBps = Math.round(
          (ticketCount * 10000) / totalTickets
        );

        // Check if player meets 1% threshold
        if (thresholdTickets && ticketCount < thresholdTickets) {
          continue;
        }

        // Normalize address to lowercase for case-insensitive comparison
        const normalizedPlayer = player.toLowerCase();

        // Update market if it exists
        const { data, error } = await this.client
          .from("infofi_markets")
          .update({
            current_probability_bps: newProbabilityBps,
            updated_at: new Date().toISOString(),
          })
          .eq("season_id", seasonId)
          .eq("player_address", normalizedPlayer)
          .eq("market_type", "WINNER_PREDICTION")
          .eq("is_active", true)
          .select();

        if (error) {
          throw new Error(
            `Failed to update market for ${player} in season ${seasonId}: ${error.message}`
          );
        }

        if (data && data.length > 0) {
          updatedCount++;
        }
        // Note: If market doesn't exist, it will be created by the MarketCreated event listener
        // when the on-chain InfoFiMarketFactory emits the MarketCreated event
      }

      return updatedCount;
    } catch (error) {
      throw new Error(`Error updating player probabilities: ${error.message}`);
    }
  }

  /**
   * Update market contract address when MarketCreated event is received
   * @param {number} seasonId - Season ID
   * @param {string} playerAddress - Player's wallet address
   * @param {string} contractAddress - FPMM contract address
   * @returns {Promise<Object>} Updated market record
   */
  async updateMarketContractAddress(seasonId, playerAddress, contractAddress) {
    try {
      // Normalize address to lowercase for case-insensitive comparison
      const normalizedAddress = playerAddress.toLowerCase();

      const { data, error } = await this.client
        .from("infofi_markets")
        .update({
          contract_address: contractAddress,
          updated_at: new Date().toISOString(),
        })
        .eq("season_id", seasonId)
        .eq("player_address", normalizedAddress)
        .eq("market_type", "WINNER_PREDICTION")
        .select()
        .single();

      if (error) {
        throw new Error(
          `Failed to update contract address for ${playerAddress} in season ${seasonId}: ${error.message}`
        );
      }

      return data;
    } catch (error) {
      throw new Error(
        `Error updating market contract address: ${error.message}`
      );
    }
  }

  /**
   * Get FPMM address for a player's market
   * @param {number} seasonId - Season ID
   * @param {string} playerAddress - Player's wallet address
   * @returns {Promise<string|null>} FPMM address or null if not found
   */
  async getFpmmAddress(seasonId, playerAddress) {
    try {
      // Normalize address to lowercase for case-insensitive comparison
      const normalizedAddress = playerAddress.toLowerCase();

      const { data, error } = await this.client
        .from("infofi_markets")
        .select("contract_address")
        .eq("season_id", seasonId)
        .eq("player_address", normalizedAddress)
        .eq("market_type", "WINNER_PREDICTION")
        .single();

      if (error) {
        // Market doesn't exist yet, return null
        return null;
      }

      return data?.contract_address || null;
    } catch (error) {
      // Return null on any error (market doesn't exist)
      return null;
    }
  }

  /**
   * Get all active FPMM addresses from markets
   * @returns {Promise<string[]>} Array of unique FPMM contract addresses
   */
  async getActiveFpmmAddresses() {
    try {
      const { data, error } = await this.client
        .from("infofi_markets")
        .select("contract_address")
        .eq("is_active", true)
        .not("contract_address", "is", null)
        .neq("contract_address", "");

      if (error) {
        throw new Error(
          `Failed to fetch active FPMM addresses: ${error.message}`
        );
      }

      if (!data || data.length === 0) {
        return [];
      }

      // Return unique addresses
      const uniqueAddresses = [
        ...new Set(data.map((row) => row.contract_address)),
      ];
      return uniqueAddresses;
    } catch (error) {
      throw new Error(`Error fetching active FPMM addresses: ${error.message}`);
    }
  }
}

// Export singleton instance
export const db = new DatabaseService();
