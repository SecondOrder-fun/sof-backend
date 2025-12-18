/**
 * Farcaster Mini App Webhook Routes
 *
 * Handles webhook events from Farcaster/Base App when users:
 * - Add the mini app (miniapp_added)
 * - Remove the mini app (miniapp_removed)
 * - Enable notifications (notifications_enabled)
 * - Disable notifications (notifications_disabled)
 */

/**
 * Decode base64url encoded string to JSON
 * @param {string} str - Base64url encoded string
 * @returns {object} Decoded JSON object
 */
function decodeBase64Url(str) {
  // Replace base64url chars with base64 chars
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
  while (base64.length % 4) {
    base64 += "=";
  }
  // Decode
  const decoded = Buffer.from(base64, "base64").toString("utf-8");
  return JSON.parse(decoded);
}

/**
 * Register Farcaster webhook routes
 * @param {import('fastify').FastifyInstance} fastify
 */
async function farcasterWebhookRoutes(fastify) {
  /**
   * POST /webhook/farcaster
   * Receives webhook events from Farcaster/Base App
   */
  fastify.post("/webhook/farcaster", async (request, reply) => {
    const body = request.body;

    fastify.log.info({ raw: body }, "[Farcaster Webhook] Received");

    try {
      let event, fid, notificationDetails;

      // Check if this is a signed payload (has header + payload fields)
      if (body.header && body.payload) {
        // Signed format - decode the base64url encoded parts
        const headerData = decodeBase64Url(body.header);
        const payloadData = decodeBase64Url(body.payload);

        fastify.log.info({ header: headerData }, "[Farcaster Webhook] Header");
        fastify.log.info(
          { payload: payloadData },
          "[Farcaster Webhook] Payload"
        );

        fid = headerData.fid;
        event = payloadData.event;
        notificationDetails = payloadData.notificationDetails;
      } else {
        // Direct format (for testing or legacy)
        event = body.event;
        fid = body.fid;
        notificationDetails = body.notificationDetails;
      }

      fastify.log.info(
        { event, fid, hasNotifications: !!notificationDetails },
        "[Farcaster Webhook] Parsed"
      );

      // Handle different event types
      switch (event) {
        case "miniapp_added":
          fastify.log.info(
            { fid, notificationDetails: !!notificationDetails },
            "[Farcaster Webhook] User added app"
          );
          // TODO: Store notification details in database if needed
          break;

        case "miniapp_removed":
          fastify.log.info({ fid }, "[Farcaster Webhook] User removed app");
          // TODO: Remove notification details from database
          break;

        case "notifications_enabled":
          fastify.log.info(
            { fid },
            "[Farcaster Webhook] User enabled notifications"
          );
          // TODO: Update notification preferences
          break;

        case "notifications_disabled":
          fastify.log.info(
            { fid },
            "[Farcaster Webhook] User disabled notifications"
          );
          // TODO: Update notification preferences
          break;

        default:
          fastify.log.warn({ event }, "[Farcaster Webhook] Unknown event type");
      }

      // Return 200 immediately - Base App requires fast response
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(
        { error: error.message },
        "[Farcaster Webhook] Error processing webhook"
      );
      // Still return 200 to not block the add operation
      return reply.send({ success: true });
    }
  });
}

export default farcasterWebhookRoutes;
