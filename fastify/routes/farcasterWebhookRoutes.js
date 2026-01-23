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
import {
  addToAllowlist,
  removeFromAllowlist,
} from "../../shared/allowlistService.js";
import process from "node:process";
import {
  parseWebhookEvent,
  verifyAppKeyWithNeynar,
} from "@farcaster/miniapp-node";

const hasNeynarApiKey = Boolean(process.env.NEYNAR_API_KEY);

/**
 * Upsert notification token for a user
 * @param {object} fastify - Fastify instance for logging
 * @param {number} fid - User's Farcaster ID
 * @param {string} appKey - Client's app key (unique per client)
 * @param {string} url - Notification URL
 * @param {string} token - Notification token
 */
async function upsertNotificationToken(fastify, fid, appKey, url, token) {
  fastify.log.info(
    {
      fid,
      appKey: appKey?.substring(0, 20),
      url: url?.substring(0, 50),
      hasToken: !!token,
      hasSupabase,
    },
    "[Farcaster Webhook] Attempting to upsert token",
  );

  if (!hasSupabase) {
    fastify.log.warn(
      "[Farcaster Webhook] Supabase not configured, skipping token storage",
    );
    return;
  }

  const { data, error } = await db.client
    .from("farcaster_notification_tokens")
    .upsert(
      {
        fid,
        app_key: appKey,
        notification_url: url,
        notification_token: token,
        notifications_enabled: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "fid,app_key",
      },
    );

  if (error) {
    fastify.log.error(
      { error: error.message, errorCode: error.code, fid },
      "[Farcaster Webhook] Failed to upsert notification token",
    );
  } else {
    fastify.log.info(
      { fid, appKey: appKey?.substring(0, 20), data },
      "[Farcaster Webhook] Notification token stored",
    );
  }
}

/**
 * Disable notifications for a user from a specific client
 * @param {object} fastify - Fastify instance for logging
 * @param {number} fid - User's Farcaster ID
 * @param {string} appKey - Client's app key
 */
async function disableNotifications(fastify, fid, appKey) {
  if (!hasSupabase) {
    fastify.log.warn(
      "[Farcaster Webhook] Supabase not configured, skipping notification disable",
    );
    return;
  }

  const { error } = await db.client
    .from("farcaster_notification_tokens")
    .update({
      notifications_enabled: false,
      updated_at: new Date().toISOString(),
    })
    .eq("fid", fid)
    .eq("app_key", appKey);

  if (error) {
    fastify.log.error(
      { error: error.message, fid, appKey },
      "[Farcaster Webhook] Failed to disable notifications",
    );
  } else {
    fastify.log.info(
      { fid, appKey: appKey?.substring(0, 20) },
      "[Farcaster Webhook] Notifications disabled",
    );
  }
}

/**
 * Delete notification token for a user from a specific client (when app is removed)
 * @param {object} fastify - Fastify instance for logging
 * @param {number} fid - User's Farcaster ID
 * @param {string} appKey - Client's app key
 */
async function deleteNotificationToken(fastify, fid, appKey) {
  if (!hasSupabase) {
    fastify.log.warn(
      "[Farcaster Webhook] Supabase not configured, skipping token deletion",
    );
    return;
  }

  const { error } = await db.client
    .from("farcaster_notification_tokens")
    .delete()
    .eq("fid", fid)
    .eq("app_key", appKey);

  if (error) {
    fastify.log.error(
      { error: error.message, fid, appKey },
      "[Farcaster Webhook] Failed to delete notification token",
    );
  } else {
    fastify.log.info(
      { fid, appKey: appKey?.substring(0, 20) },
      "[Farcaster Webhook] Notification token deleted",
    );
  }
}

/**
 * Register Farcaster webhook routes
 * @param {import('fastify').FastifyInstance} fastify
 */
async function farcasterWebhookRoutes(fastify) {
  if (!hasNeynarApiKey) {
    fastify.log.warn(
      "[Farcaster Webhook] NEYNAR_API_KEY is not set. Skipping /api/webhook/farcaster route registration.",
    );
    return;
  }

  /**
   * POST /webhook/farcaster
   * Receives webhook events from Farcaster/Base App
   */
  fastify.post("/webhook/farcaster", async (request, reply) => {
    const body = request.body;

    fastify.log.info({ raw: body }, "[Farcaster Webhook] Received");

    try {
      if (!body?.header || !body?.payload || !body?.signature) {
        fastify.log.warn(
          { hasHeader: !!body?.header, hasPayload: !!body?.payload },
          "[Farcaster Webhook] Unverified webhook payload format - ignoring",
        );
        return reply.send({ success: true });
      }

      let event, fid, appKey, notificationDetails;

      try {
        const verified = await parseWebhookEvent(body, verifyAppKeyWithNeynar);

        fid = verified?.header?.fid;
        appKey = verified?.header?.key;
        event = verified?.payload?.event;
        notificationDetails = verified?.payload?.notificationDetails;
      } catch (e) {
        const error = e;
        const errorName =
          error && typeof error === "object" && "name" in error
            ? String(error.name)
            : "Unknown";

        fastify.log.warn(
          { errorName },
          "[Farcaster Webhook] Signature verification failed - ignoring",
        );

        return reply.send({ success: true });
      }

      if (!fid || !event) {
        fastify.log.warn(
          { fid, event },
          "[Farcaster Webhook] Verified payload missing required fields - ignoring",
        );
        return reply.send({ success: true });
      }

      fastify.log.info(
        { event, fid, hasNotifications: !!notificationDetails },
        "[Farcaster Webhook] Parsed",
      );

      // Handle different event types
      // Note: Base App uses "frame_added"/"frame_removed", Warpcast uses "miniapp_added"/"miniapp_removed"
      switch (event) {
        case "frame_added":
        case "miniapp_added":
          fastify.log.info(
            {
              fid,
              appKey: appKey?.substring(0, 20),
              hasNotifications: !!notificationDetails,
            },
            "[Farcaster Webhook] User added app",
          );
          // Store notification token if provided
          if (notificationDetails?.url && notificationDetails?.token) {
            await upsertNotificationToken(
              fastify,
              fid,
              appKey,
              notificationDetails.url,
              notificationDetails.token,
            );
          }
          // Add user to allowlist (respects time-gate)
          try {
            const allowlistResult = await addToAllowlist(fid, "webhook");
            if (allowlistResult.success) {
              fastify.log.info(
                { fid, wallet: allowlistResult.entry?.wallet_address },
                "[Farcaster Webhook] User added to allowlist",
              );
            } else {
              fastify.log.info(
                { fid, reason: allowlistResult.error },
                "[Farcaster Webhook] User not added to allowlist",
              );
            }
          } catch (allowlistError) {
            fastify.log.warn(
              { error: allowlistError.message, fid },
              "[Farcaster Webhook] Failed to add user to allowlist",
            );
          }
          break;

        case "frame_removed":
        case "miniapp_removed":
          fastify.log.info(
            { fid, appKey: appKey?.substring(0, 20) },
            "[Farcaster Webhook] User removed app",
          );
          // Delete notification token for this specific client only
          await deleteNotificationToken(fastify, fid, appKey);
          // Revoke allowlist access when app is removed
          try {
            const removeResult = await removeFromAllowlist(fid);
            if (removeResult.success) {
              fastify.log.info(
                { fid },
                "[Farcaster Webhook] User removed from allowlist",
              );
            } else {
              fastify.log.warn(
                { fid, error: removeResult.error },
                "[Farcaster Webhook] Failed to remove user from allowlist",
              );
            }
          } catch (removeError) {
            fastify.log.warn(
              { fid, error: removeError?.message },
              "[Farcaster Webhook] Error removing user from allowlist",
            );
          }
          break;

        case "notifications_enabled":
          fastify.log.info(
            { fid, appKey: appKey?.substring(0, 20) },
            "[Farcaster Webhook] User enabled notifications",
          );
          // Store/update notification token
          if (notificationDetails?.url && notificationDetails?.token) {
            await upsertNotificationToken(
              fastify,
              fid,
              appKey,
              notificationDetails.url,
              notificationDetails.token,
            );
          }
          break;

        case "notifications_disabled":
          fastify.log.info(
            { fid, appKey: appKey?.substring(0, 20) },
            "[Farcaster Webhook] User disabled notifications",
          );
          // Mark notifications as disabled for this specific client only
          await disableNotifications(fastify, fid, appKey);
          break;

        default:
          fastify.log.warn({ event }, "[Farcaster Webhook] Unknown event type");
      }

      // Return 200 immediately - Base App requires fast response
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(
        { error: error.message },
        "[Farcaster Webhook] Error processing webhook",
      );
      // Still return 200 to not block the add operation
      return reply.send({ success: true });
    }
  });
}

export default farcasterWebhookRoutes;
