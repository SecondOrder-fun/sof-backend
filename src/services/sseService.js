/**
 * @file sseService.js
 * @description Service for managing Server-Sent Events (SSE) connections
 * Handles real-time updates to connected clients for market creation events
 * @author SecondOrder.fun
 */

/**
 * SSEService - Manages Server-Sent Events for real-time updates
 * @class
 */
export class SSEService {
  constructor(logger) {
    this.logger = logger;
    this.connections = new Map(); // Map of connectionId -> response object
    this.connectionCount = 0;
  }

  /**
   * Add a new SSE connection
   * @param {string} id - Unique connection identifier
   * @param {Object} reply - Fastify reply object
   * @returns {void}
   */
  addConnection(id, reply) {
    this.connections.set(id, reply);
    this.connectionCount++;
    this.logger.info(`📡 SSE connection added: ${id} (total: ${this.connectionCount})`);
  }

  /**
   * Remove an SSE connection
   * @param {string} id - Connection identifier
   * @returns {void}
   */
  removeConnection(id) {
    if (this.connections.has(id)) {
      this.connections.delete(id);
      this.connectionCount--;
      this.logger.info(`📡 SSE connection removed: ${id} (total: ${this.connectionCount})`);
    }
  }

  /**
   * Broadcast a message to all connected clients
   * @param {Object} message - Message object to broadcast
   * @param {string} message.event - Event type (e.g., 'market-creation-started')
   * @param {Object} message.data - Event data
   * @returns {Object} Broadcast result with success count and failures
   */
  broadcast(message) {
    const result = {
      sent: 0,
      failed: 0,
      failedConnections: [],
    };

    const eventData = `data: ${JSON.stringify(message)}\n\n`;

    for (const [id, reply] of this.connections.entries()) {
      try {
        reply.raw.write(eventData);
        result.sent++;
      } catch (error) {
        this.logger.error(`❌ Failed to send SSE to ${id}: ${error.message}`);
        result.failed++;
        result.failedConnections.push(id);
        // Remove failed connection
        this.removeConnection(id);
      }
    }

    if (result.sent > 0) {
      this.logger.debug(
        `📤 Broadcast sent to ${result.sent} clients (${result.failed} failed)`
      );
    }

    return result;
  }

  /**
   * Broadcast market creation started event
   * @param {Object} data - Event data
   * @param {number} data.seasonId - Season identifier
   * @param {string} data.player - Player address
   * @param {number} data.probability - Win probability in basis points
   * @returns {Object} Broadcast result
   */
  broadcastMarketCreationStarted(data) {
    return this.broadcast({
      event: 'market-creation-started',
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast market creation confirmed event
   * @param {Object} data - Event data
   * @param {number} data.seasonId - Season identifier
   * @param {string} data.player - Player address
   * @param {string} data.transactionHash - Transaction hash
   * @param {string} data.marketAddress - Created market address
   * @returns {Object} Broadcast result
   */
  broadcastMarketCreationConfirmed(data) {
    return this.broadcast({
      event: 'market-creation-confirmed',
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast market creation failed event
   * @param {Object} data - Event data
   * @param {number} data.seasonId - Season identifier
   * @param {string} data.player - Player address
   * @param {string} data.error - Error message
   * @returns {Object} Broadcast result
   */
  broadcastMarketCreationFailed(data) {
    return this.broadcast({
      event: 'market-creation-failed',
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get connection count
   * @returns {number} Number of active connections
   */
  getConnectionCount() {
    return this.connectionCount;
  }

  /**
   * Get all connection IDs
   * @returns {Array<string>} Array of connection IDs
   */
  getConnectionIds() {
    return Array.from(this.connections.keys());
  }

  /**
   * Close all connections
   * @returns {void}
   */
  closeAllConnections() {
    for (const [id, reply] of this.connections.entries()) {
      try {
        reply.raw.end();
      } catch (error) {
        this.logger.error(`Error closing connection ${id}: ${error.message}`);
      }
    }
    this.connections.clear();
    this.connectionCount = 0;
    this.logger.info('📡 All SSE connections closed');
  }
}

// Export singleton instance
let sseServiceInstance = null;

/**
 * Get or create SSEService singleton
 * @param {Object} logger - Logger instance
 * @returns {SSEService} SSEService instance
 */
export function getSSEService(logger) {
  if (!sseServiceInstance) {
    sseServiceInstance = new SSEService(logger);
  }
  return sseServiceInstance;
}
