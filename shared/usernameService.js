// backend/shared/usernameService.js
import { redisClient } from './redisClient.js';

/**
 * Username Service
 * Manages wallet address -> username mappings in Redis
 */
class UsernameService {
  constructor() {
    this.WALLET_PREFIX = 'wallet:';
    this.USERNAME_PREFIX = 'username:';
    this.RESERVED_USERNAMES = ['admin', 'system', 'null', 'undefined', 'root', 'moderator'];
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

  /**
   * Get username for a wallet address
   * @param {string} address - Wallet address (checksummed or lowercase)
   * @returns {Promise<string|null>} Username or null if not set
   */
  async getUsernameByAddress(address) {
    try {
      const normalizedAddress = address.toLowerCase();
      const client = redisClient.getClient();
      const username = await client.get(`${this.WALLET_PREFIX}${normalizedAddress}`);
      return username;
    } catch (error) {
      this.getLogger().error({ err: error }, '[UsernameService] Error getting username');
      return null;
    }
  }

  /**
   * Get wallet address for a username (reverse lookup)
   * @param {string} username - Username to lookup
   * @returns {Promise<string|null>} Wallet address or null
   */
  async getAddressByUsername(username) {
    try {
      const normalizedUsername = username.toLowerCase();
      const client = redisClient.getClient();
      const address = await client.get(`${this.USERNAME_PREFIX}${normalizedUsername}`);
      return address;
    } catch (error) {
      this.getLogger().error({ err: error }, '[UsernameService] Error getting address');
      return null;
    }
  }

  /**
   * Set username for a wallet address
   * @param {string} address - Wallet address
   * @param {string} username - Desired username
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async setUsername(address, username) {
    try {
      // Validate username
      const validation = this.validateUsername(username);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const normalizedAddress = address.toLowerCase();
      const normalizedUsername = username.toLowerCase();

      // Check if username is already taken by another address
      const existingAddress = await this.getAddressByUsername(normalizedUsername);
      if (existingAddress && existingAddress !== normalizedAddress) {
        return { success: false, error: 'USERNAME_TAKEN' };
      }

      // Get old username to clean up reverse lookup
      const oldUsername = await this.getUsernameByAddress(normalizedAddress);

      const client = redisClient.getClient();
      const pipeline = client.pipeline();

      // Set new mappings
      pipeline.set(`${this.WALLET_PREFIX}${normalizedAddress}`, username);
      pipeline.set(`${this.USERNAME_PREFIX}${normalizedUsername}`, normalizedAddress);

      // Clean up old username reverse lookup if it exists
      if (oldUsername && oldUsername.toLowerCase() !== normalizedUsername) {
        pipeline.del(`${this.USERNAME_PREFIX}${oldUsername.toLowerCase()}`);
      }

      await pipeline.exec();

      this.getLogger().info(`[UsernameService] Set username "${username}" for ${address}`);
      return { success: true };
    } catch (error) {
      this.getLogger().error({ err: error }, '[UsernameService] Error setting username');
      return { success: false, error: 'INTERNAL_ERROR' };
    }
  }

  /**
   * Validate username format
   * @param {string} username - Username to validate
   * @returns {{valid: boolean, error?: string}}
   */
  validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: 'USERNAME_REQUIRED' };
    }

    const trimmed = username.trim();

    if (trimmed.length < 3) {
      return { valid: false, error: 'USERNAME_TOO_SHORT' };
    }

    if (trimmed.length > 20) {
      return { valid: false, error: 'USERNAME_TOO_LONG' };
    }

    // Only alphanumeric and underscore
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return { valid: false, error: 'USERNAME_INVALID_CHARS' };
    }

    // Check reserved usernames
    if (this.RESERVED_USERNAMES.includes(trimmed.toLowerCase())) {
      return { valid: false, error: 'USERNAME_RESERVED' };
    }

    return { valid: true };
  }

  /**
   * Check if username is available
   * @param {string} username - Username to check
   * @returns {Promise<boolean>} True if available
   */
  async isUsernameAvailable(username) {
    try {
      const validation = this.validateUsername(username);
      if (!validation.valid) {
        return false;
      }

      const existingAddress = await this.getAddressByUsername(username);
      return !existingAddress;
    } catch (error) {
      this.getLogger().error({ err: error }, '[UsernameService] Error checking availability');
      return false;
    }
  }

  /**
   * Get batch usernames for multiple addresses
   * @param {string[]} addresses - Array of wallet addresses
   * @returns {Promise<Map<string, string|null>>} Map of address -> username
   */
  async getBatchUsernames(addresses) {
    try {
      const client = redisClient.getClient();
      const normalizedAddresses = addresses.map(addr => addr.toLowerCase());
      const keys = normalizedAddresses.map(addr => `${this.WALLET_PREFIX}${addr}`);
      
      const usernames = await client.mget(...keys);
      
      const result = new Map();
      addresses.forEach((addr, index) => {
        result.set(addr.toLowerCase(), usernames[index]);
      });
      
      return result;
    } catch (error) {
      console.error('[UsernameService] Error getting batch usernames:', error.message);
      return new Map();
    }
  }

  /**
   * Get all username mappings (for admin/debug)
   * @returns {Promise<Array<{address: string, username: string}>>}
   */
  async getAllUsernames() {
    try {
      const client = redisClient.getClient();
      const keys = await client.keys(`${this.WALLET_PREFIX}*`);
      
      if (keys.length === 0) {
        return [];
      }

      const values = await client.mget(...keys);
      
      return keys.map((key, index) => ({
        address: key.replace(this.WALLET_PREFIX, ''),
        username: values[index]
      })).filter(item => item.username);
    } catch (error) {
      console.error('[UsernameService] Error getting all usernames:', error.message);
      return [];
    }
  }
}

export const usernameService = new UsernameService();
