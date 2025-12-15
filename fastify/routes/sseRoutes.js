/**
 * @file sseRoutes.js
 * @description Fastify routes for Server-Sent Events (SSE)
 * Provides real-time market creation updates to connected clients
 * @author SecondOrder.fun
 */

import { getSSEService } from '../../src/services/sseService.js';

/**
 * Register SSE routes
 * @async
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Route options
 * @param {Object} options.logger - Logger instance
 * @returns {Promise<void>}
 */
export async function registerSSERoutes(fastify, options) {
  const { logger } = options;
  const sseService = getSSEService(logger);

  /**
   * GET /market-events
   * Server-Sent Events endpoint for real-time market creation updates
   * Clients connect here to receive live updates
   */
  fastify.get('/market-events', async (request, reply) => {
    // Generate unique connection ID
    const connectionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Add connection to service
    sseService.addConnection(connectionId, reply);

    // Send initial connection confirmation
    reply.raw.write(
      `data: ${JSON.stringify({
        event: 'connected',
        data: { connectionId },
        timestamp: new Date().toISOString(),
      })}\n\n`
    );

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch (error) {
        logger.debug(`Heartbeat failed for ${connectionId}, closing connection`);
        clearInterval(heartbeatInterval);
        sseService.removeConnection(connectionId);
      }
    }, 30000);

    // Handle client disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      sseService.removeConnection(connectionId);
      logger.debug(`Client disconnected: ${connectionId}`);
    });

    // Handle errors
    request.raw.on('error', (error) => {
      logger.error(`SSE connection error for ${connectionId}: ${error.message}`);
      clearInterval(heartbeatInterval);
      sseService.removeConnection(connectionId);
    });
  });

  /**
   * GET /market-events/health
   * Health check endpoint for SSE service
   * Returns current connection count and status
   */
  fastify.get('/market-events/health', async () => {
    return {
      status: 'ok',
      connections: sseService.getConnectionCount(),
      connectionIds: sseService.getConnectionIds(),
      timestamp: new Date().toISOString(),
    };
  });

  logger.info('✅ SSE routes registered');
}

export default registerSSERoutes;
