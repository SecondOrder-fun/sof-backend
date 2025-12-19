/**
 * Farcaster Notification Service
 *
 * Handles sending notifications to Farcaster/Base App users
 * via their stored notification tokens.
 */

import { db, hasSupabase } from "./supabaseClient.js";
import crypto from "crypto";

/**
 * Get all notification tokens for a user (across all clients)
 * @param {number} fid - User's Farcaster ID
 * @returns {Promise<Array>} Array of notification token records
 */
export async function getNotificationTokens(fid) {
  if (!hasSupabase) {
    return [];
  }

  const { data, error } = await db.client
    .from("farcaster_notification_tokens")
    .select("*")
    .eq("fid", fid)
    .eq("notifications_enabled", true);

  if (error) {
    console.error(
      `[FarcasterNotification] Failed to get tokens for fid ${fid}:`,
      error.message
    );
    return [];
  }

  return data || [];
}

/**
 * Get all users with notifications enabled
 * @returns {Promise<Array>} Array of notification token records
 */
export async function getAllEnabledTokens() {
  if (!hasSupabase) {
    return [];
  }

  const { data, error } = await db.client
    .from("farcaster_notification_tokens")
    .select("*")
    .eq("notifications_enabled", true);

  if (error) {
    console.error(
      "[FarcasterNotification] Failed to get all enabled tokens:",
      error.message
    );
    return [];
  }

  return data || [];
}

/**
 * Send a notification to a specific user across all their clients
 * @param {object} params - Notification parameters
 * @param {number} params.fid - User's Farcaster ID
 * @param {string} params.title - Notification title
 * @param {string} params.body - Notification body
 * @param {string} params.targetUrl - URL to open when notification is tapped
 * @returns {Promise<object>} Result with state and details
 */
export async function sendNotificationToUser({ fid, title, body, targetUrl }) {
  const tokens = await getNotificationTokens(fid);

  if (tokens.length === 0) {
    return { state: "no_tokens", fid };
  }

  const results = [];

  for (const tokenRecord of tokens) {
    const result = await sendNotification({
      url: tokenRecord.notification_url,
      token: tokenRecord.notification_token,
      title,
      body,
      targetUrl,
    });

    results.push({
      appKey: tokenRecord.app_key,
      ...result,
    });
  }

  const successCount = results.filter((r) => r.state === "success").length;

  return {
    state: successCount > 0 ? "success" : "failed",
    fid,
    totalClients: tokens.length,
    successCount,
    results,
  };
}

/**
 * Send a notification using a specific token
 * @param {object} params - Notification parameters
 * @param {string} params.url - Notification URL
 * @param {string} params.token - Notification token
 * @param {string} params.title - Notification title
 * @param {string} params.body - Notification body
 * @param {string} params.targetUrl - URL to open when notification is tapped
 * @returns {Promise<object>} Result with state and details
 */
export async function sendNotification({ url, token, title, body, targetUrl }) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        notificationId: crypto.randomUUID(),
        title,
        body,
        targetUrl,
        tokens: [token],
      }),
    });

    const responseJson = await response.json();

    if (response.status === 200) {
      // Check for rate limiting
      if (responseJson.result?.rateLimitedTokens?.length > 0) {
        return { state: "rate_limited", response: responseJson };
      }

      // Check for invalid tokens
      if (responseJson.result?.invalidTokens?.length > 0) {
        return { state: "invalid_token", response: responseJson };
      }

      return { state: "success", response: responseJson };
    } else {
      return {
        state: "error",
        status: response.status,
        response: responseJson,
      };
    }
  } catch (error) {
    return { state: "error", error: error.message };
  }
}

/**
 * Send a notification to all users with notifications enabled
 * @param {object} params - Notification parameters
 * @param {string} params.title - Notification title
 * @param {string} params.body - Notification body
 * @param {string} params.targetUrl - URL to open when notification is tapped
 * @returns {Promise<object>} Result with state and details
 */
export async function sendNotificationToAll({ title, body, targetUrl }) {
  const tokens = await getAllEnabledTokens();

  if (tokens.length === 0) {
    return { state: "no_tokens", totalUsers: 0 };
  }

  // Group tokens by notification URL for batch sending
  const tokensByUrl = {};
  for (const tokenRecord of tokens) {
    const url = tokenRecord.notification_url;
    if (!tokensByUrl[url]) {
      tokensByUrl[url] = [];
    }
    tokensByUrl[url].push(tokenRecord.notification_token);
  }

  const results = [];

  // Send batch notifications to each URL
  for (const [url, tokenList] of Object.entries(tokensByUrl)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notificationId: crypto.randomUUID(),
          title,
          body,
          targetUrl,
          tokens: tokenList,
        }),
      });

      const responseJson = await response.json();

      results.push({
        url,
        tokenCount: tokenList.length,
        status: response.status,
        response: responseJson,
      });
    } catch (error) {
      results.push({
        url,
        tokenCount: tokenList.length,
        state: "error",
        error: error.message,
      });
    }
  }

  const successCount = results.filter((r) => r.status === 200).length;

  return {
    state: successCount > 0 ? "success" : "failed",
    totalTokens: tokens.length,
    uniqueUrls: Object.keys(tokensByUrl).length,
    results,
  };
}

export default {
  getNotificationTokens,
  getAllEnabledTokens,
  sendNotificationToUser,
  sendNotification,
  sendNotificationToAll,
};
