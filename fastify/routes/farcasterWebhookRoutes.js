/**
 * Farcaster Mini App Webhook Routes
 *
 * Handles webhook events from Farcaster/Base App when users:
 * - Add the mini app (miniapp_added)
 * - Remove the mini app (miniapp_removed)
 * - Enable notifications (notifications_enabled)
 * - Disable notifications (notifications_disabled)
 */

import { db, hasSupabase } from "../../shared/supabaseClient.js";

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
 * Upsert notification token for a user
 * @param {object} fastify - Fastify instance for logging
 * @param {number} fid - User's Farcaster ID
 * @param {string} url - Notification URL
 * @param {string} token - Notification token (unique per client/app/user)
 */
async function upsertNotificationToken(fastify, fid, url, token) {
  fastify.log.info(
    { fid, url: url?.substring(0, 50), hasToken: !!token, hasSupabase },
    "[Farcaster Webhook] Attempting to upsert token"
  );

  if (!hasSupabase) {
    fastify.log.warn(
      "[Farcaster Webhook] Supabase not configured, skipping token storage"
    );
    return;
  }

  const { data, error } = await db.client
    .from("farcaster_notification_tokens")
    .upsert(
      {
        fid,
        notification_url: url,
        notification_token: token,
        notifications_enabled: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "notification_token",
      }
    );

  if (error) {
    fastify.log.error(
      { error: error.message, errorCode: error.code, fid },
      "[Farcaster Webhook] Failed to upsert notification token"
    );
  } else {
    fastify.log.info(
      { fid, data },
      "[Farcaster Webhook] Notification token stored"
    );
  }
}

/**
 * Disable notifications for a user
 * @param {object} fastify - Fastify instance for logging
 * @param {number} fid - User's Farcaster ID
 */
async function disableNotifications(fastify, fid) {
  if (!hasSupabase) {
    fastify.log.warn(
      "[Farcaster Webhook] Supabase not configured, skipping notification disable"
    );
    return;
  }

  const { error } = await db.client
    .from("farcaster_notification_tokens")
    .update({
      notifications_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("fid", fid);

  if (error) {
    fastify.log.error(
      { error: error.message, fid },
      "[Farcaster Webhook] Failed to disable notifications"
    );
  } else {
    fastify.log.info({ fid }, "[Farcaster Webhook] Notifications disabled");
  }
}

/**
 * Delete notification tokens for a user (when app is removed)
 * @param {object} fastify - Fastify instance for logging
 * @param {number} fid - User's Farcaster ID
 */
async function deleteNotificationToken(fastify, fid) {
  if (!hasSupabase) {
    fastify.log.warn(
      "[Farcaster Webhook] Supabase not configured, skipping token deletion"
    );
    return;
  }

  const { error } = await db.client
    .from("farcaster_notification_tokens")
    .delete()
    .eq("fid", fid);

  if (error) {
    fastify.log.error(
      { error: error.message, fid },
      "[Farcaster Webhook] Failed to delete notification token"
    );
  } else {
    fastify.log.info({ fid }, "[Farcaster Webhook] Notification token deleted");
  }
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
            { fid, hasNotifications: !!notificationDetails },
            "[Farcaster Webhook] User added app"
          );
          // Store notification token if provided
          if (notificationDetails?.url && notificationDetails?.token) {
            await upsertNotificationToken(
              fastify,
              fid,
              notificationDetails.url,
              notificationDetails.token
            );
          }
          break;

        case "miniapp_removed":
          fastify.log.info({ fid }, "[Farcaster Webhook] User removed app");
          // Delete notification tokens for this user
          await deleteNotificationToken(fastify, fid);
          break;

        case "notifications_enabled":
          fastify.log.info(
            { fid },
            "[Farcaster Webhook] User enabled notifications"
          );
          // Store/update notification token
          if (notificationDetails?.url && notificationDetails?.token) {
            await upsertNotificationToken(
              fastify,
              fid,
              notificationDetails.url,
              notificationDetails.token
            );
          }
          break;

        case "notifications_disabled":
          fastify.log.info(
            { fid },
            "[Farcaster Webhook] User disabled notifications"
          );
          // Mark notifications as disabled
          await disableNotifications(fastify, fid);
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
