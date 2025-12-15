// backend/shared/redisClient.js
import Redis from 'ioredis';
import process from 'node:process';

/**
 * Redis Client Singleton
 * Supports both local development (redis://localhost:6379) and production (Upstash)
 */
class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
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
   * Resolve Redis URL based on environment
   */
  getRedisUrl() {
    const env = process.env.REDIS_ENV || process.env.NODE_ENV || 'local';

    if (env === 'prod') {
      return process.env.REDIS_URL_PROD || process.env.REDIS_URL || 'redis://localhost:6379';
    }

    if (env === 'staging') {
      return process.env.REDIS_URL_STAGING || process.env.REDIS_URL || 'redis://localhost:6379';
    }

    if (env === 'dev') {
      return process.env.REDIS_URL_DEV || process.env.REDIS_URL || 'redis://localhost:6379';
    }

    return process.env.REDIS_URL || 'redis://localhost:6379';
  }

  /**
   * Initialize Redis connection
   */
  connect() {
    if (this.client) {
      return this.client;
    }

    const redisUrl = this.getRedisUrl();

    try {
      this.client = new Redis(redisUrl, {
        // Enable TLS for production (Upstash uses rediss://)
        tls: redisUrl.startsWith('rediss://') ? {} : undefined,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: false,
        enableReadyCheck: true,
      });

      this.client.on('connect', () => {
        this.getLogger().info('[Redis] Connected successfully');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        this.getLogger().error({ err }, '[Redis] Connection error');
        this.isConnected = false;
      });

      this.client.on('close', () => {
        this.getLogger().info('[Redis] Connection closed');
        this.isConnected = false;
      });

      return this.client;
    } catch (error) {
      this.getLogger().error({ err: error }, '[Redis] Failed to initialize');
      throw error;
    }
  }

  /**
   * Get the Redis client instance
   */
  getClient() {
    if (!this.client) {
      return this.connect();
    }
    return this.client;
  }

  /**
   * Gracefully disconnect
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      this.getLogger().info('[Redis] Disconnected');
    }
  }

  /**
   * Health check
   */
  async ping() {
    try {
      const client = this.getClient();
      const result = await client.ping();
      return result === 'PONG';
    } catch (error) {
      this.getLogger().error({ err: error }, '[Redis] Ping failed');
      return false;
    }
  }
}

// Export singleton instance
export const redisClient = new RedisClient();
