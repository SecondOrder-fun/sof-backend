/**
 * Allowlist Service
 * Manages wallet-based allowlist with time-gated additions
 */

import { db, hasSupabase } from "./supabaseClient.js";
import { resolveFidToWallet } from "./fidResolverService.js";

/**
 * Check if the allowlist window is currently open
 * @returns {Promise<{isOpen: boolean, config: object|null, reason?: string}>}
 */
export async function isAllowlistWindowOpen() {
  if (!hasSupabase) {
    return { isOpen: false, config: null, reason: "Database not configured" };
  }

  try {
    const { data, error } = await db.client
      .from("allowlist_config")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return { isOpen: false, config: null, reason: "No active config found" };
    }

    const now = new Date();
    const windowStart = new Date(data.window_start);
    const windowEnd = data.window_end ? new Date(data.window_end) : null;

    // Check if we're before the window starts
    if (now < windowStart) {
      return {
        isOpen: false,
        config: data,
        reason: `Window opens at ${windowStart.toISOString()}`,
      };
    }

    // Check if we're after the window ends (if there's an end date)
    if (windowEnd && now > windowEnd) {
      return {
        isOpen: false,
        config: data,
        reason: `Window closed at ${windowEnd.toISOString()}`,
      };
    }

    // Check max entries if configured
    if (data.max_entries) {
      const { count } = await db.client
        .from("allowlist_entries")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

      if (count >= data.max_entries) {
        return {
          isOpen: false,
          config: data,
          reason: `Max entries (${data.max_entries}) reached`,
        };
      }
    }

    return { isOpen: true, config: data };
  } catch (error) {
    console.error("[Allowlist] Error checking window:", error);
    return { isOpen: false, config: null, reason: error.message };
  }
}

/**
 * Add a user to the allowlist by FID
 * @param {number} fid - Farcaster ID
 * @param {string} source - How they were added: 'webhook', 'manual', 'import'
 * @param {boolean} bypassTimeGate - Skip time gate check (for manual adds)
 * @returns {Promise<{success: boolean, entry?: object, error?: string}>}
 */
export async function addToAllowlist(
  fid,
  source = "webhook",
  bypassTimeGate = false
) {
  if (!hasSupabase) {
    return { success: false, error: "Database not configured" };
  }

  if (!fid || typeof fid !== "number") {
    return { success: false, error: "Invalid FID" };
  }

  try {
    // Check time gate unless bypassed
    if (!bypassTimeGate) {
      const windowCheck = await isAllowlistWindowOpen();
      if (!windowCheck.isOpen) {
        console.log(
          `[Allowlist] Window closed for FID ${fid}: ${windowCheck.reason}`
        );
        return {
          success: false,
          error: `Allowlist window closed: ${windowCheck.reason}`,
        };
      }
    }

    // Check if already exists
    const { data: existing } = await db.client
      .from("allowlist_entries")
      .select("id, fid, wallet_address, is_active")
      .eq("fid", fid)
      .single();

    if (existing) {
      // If exists but inactive, reactivate
      if (!existing.is_active) {
        const { data: updated, error: updateError } = await db.client
          .from("allowlist_entries")
          .update({
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (updateError) {
          return { success: false, error: updateError.message };
        }

        console.log(`[Allowlist] Reactivated FID ${fid}`);
        return { success: true, entry: updated, reactivated: true };
      }

      // Already active
      console.log(`[Allowlist] FID ${fid} already in allowlist`);
      return { success: true, entry: existing, alreadyExists: true };
    }

    // Resolve FID to wallet address
    let walletData = { address: null };
    try {
      walletData = await resolveFidToWallet(fid);
      console.log(
        `[Allowlist] Resolved FID ${fid} to wallet: ${
          walletData.address || "none"
        }`
      );
    } catch (resolveError) {
      console.warn(
        `[Allowlist] Failed to resolve FID ${fid}:`,
        resolveError.message
      );
      // Continue without wallet - can be resolved later
    }

    // Insert new entry
    const { data: entry, error: insertError } = await db.client
      .from("allowlist_entries")
      .insert({
        fid,
        wallet_address: walletData.address,
        username: walletData.username,
        display_name: walletData.displayName,
        source,
        is_active: true,
        added_at: new Date().toISOString(),
        wallet_resolved_at: walletData.address
          ? new Date().toISOString()
          : null,
        metadata: walletData.pfpUrl ? { pfpUrl: walletData.pfpUrl } : {},
      })
      .select()
      .single();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    console.log(
      `[Allowlist] Added FID ${fid} (wallet: ${
        walletData.address || "pending"
      })`
    );
    return { success: true, entry };
  } catch (error) {
    console.error(`[Allowlist] Error adding FID ${fid}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a user from the allowlist (soft delete)
 * @param {number} fid - Farcaster ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function removeFromAllowlist(fid) {
  if (!hasSupabase) {
    return { success: false, error: "Database not configured" };
  }

  try {
    const { error } = await db.client
      .from("allowlist_entries")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("fid", fid);

    if (error) {
      return { success: false, error: error.message };
    }

    console.log(`[Allowlist] Removed FID ${fid}`);
    return { success: true };
  } catch (error) {
    console.error(`[Allowlist] Error removing FID ${fid}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if a wallet address is in the allowlist
 * @param {string} walletAddress - Ethereum address
 * @returns {Promise<{isAllowlisted: boolean, entry?: object}>}
 */
export async function isWalletAllowlisted(walletAddress) {
  if (!hasSupabase || !walletAddress) {
    return { isAllowlisted: false };
  }

  try {
    const { data, error } = await db.client
      .from("allowlist_entries")
      .select("*")
      .eq("wallet_address", walletAddress.toLowerCase())
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return { isAllowlisted: false };
    }

    return { isAllowlisted: true, entry: data };
  } catch (error) {
    console.error("[Allowlist] Error checking wallet:", error);
    return { isAllowlisted: false };
  }
}

/**
 * Check if a FID is in the allowlist
 * @param {number} fid - Farcaster ID
 * @returns {Promise<{isAllowlisted: boolean, entry?: object}>}
 */
export async function isFidAllowlisted(fid) {
  if (!hasSupabase || !fid) {
    return { isAllowlisted: false };
  }

  try {
    const { data, error } = await db.client
      .from("allowlist_entries")
      .select("*")
      .eq("fid", fid)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return { isAllowlisted: false };
    }

    return { isAllowlisted: true, entry: data };
  } catch (error) {
    console.error("[Allowlist] Error checking FID:", error);
    return { isAllowlisted: false };
  }
}

/**
 * Get all allowlist entries
 * @param {object} options - Query options
 * @param {boolean} options.activeOnly - Only return active entries
 * @param {number} options.limit - Max entries to return
 * @returns {Promise<{entries: object[], count: number}>}
 */
export async function getAllowlistEntries({
  activeOnly = true,
  limit = 500,
} = {}) {
  if (!hasSupabase) {
    return { entries: [], count: 0 };
  }

  try {
    let query = db.client
      .from("allowlist_entries")
      .select("*", { count: "exact" })
      .order("added_at", { ascending: false })
      .limit(limit);

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    return { entries: data || [], count: count || 0 };
  } catch (error) {
    console.error("[Allowlist] Error fetching entries:", error);
    return { entries: [], count: 0 };
  }
}

/**
 * Get allowlist statistics
 * @returns {Promise<object>}
 */
export async function getAllowlistStats() {
  if (!hasSupabase) {
    return { total: 0, active: 0, withWallet: 0, pendingResolution: 0 };
  }

  try {
    // Total entries
    const { count: total } = await db.client
      .from("allowlist_entries")
      .select("*", { count: "exact", head: true });

    // Active entries
    const { count: active } = await db.client
      .from("allowlist_entries")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    // With wallet resolved
    const { count: withWallet } = await db.client
      .from("allowlist_entries")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .not("wallet_address", "is", null);

    // Pending resolution
    const { count: pendingResolution } = await db.client
      .from("allowlist_entries")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .is("wallet_address", null);

    // Get window status
    const windowStatus = await isAllowlistWindowOpen();

    return {
      total: total || 0,
      active: active || 0,
      withWallet: withWallet || 0,
      pendingResolution: pendingResolution || 0,
      windowOpen: windowStatus.isOpen,
      windowConfig: windowStatus.config,
    };
  } catch (error) {
    console.error("[Allowlist] Error fetching stats:", error);
    return { total: 0, active: 0, withWallet: 0, pendingResolution: 0 };
  }
}

/**
 * Update allowlist window configuration
 * @param {object} config - New configuration
 * @param {Date} config.windowStart - When window opens
 * @param {Date|null} config.windowEnd - When window closes (null = indefinite)
 * @param {number|null} config.maxEntries - Max entries allowed
 * @returns {Promise<{success: boolean, config?: object, error?: string}>}
 */
export async function updateAllowlistConfig({
  windowStart,
  windowEnd,
  maxEntries,
}) {
  if (!hasSupabase) {
    return { success: false, error: "Database not configured" };
  }

  try {
    // Deactivate current config
    await db.client
      .from("allowlist_config")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("is_active", true);

    // Insert new config
    const { data, error } = await db.client
      .from("allowlist_config")
      .insert({
        name: "default",
        window_start: windowStart || new Date().toISOString(),
        window_end: windowEnd || null,
        max_entries: maxEntries || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    console.log("[Allowlist] Config updated:", data);
    return { success: true, config: data };
  } catch (error) {
    console.error("[Allowlist] Error updating config:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Retry wallet resolution for entries without wallets
 * @returns {Promise<{resolved: number, failed: number}>}
 */
export async function retryPendingWalletResolutions() {
  if (!hasSupabase) {
    return { resolved: 0, failed: 0 };
  }

  try {
    // Get entries without wallet addresses
    const { data: pending } = await db.client
      .from("allowlist_entries")
      .select("id, fid")
      .eq("is_active", true)
      .is("wallet_address", null)
      .limit(50);

    if (!pending || pending.length === 0) {
      return { resolved: 0, failed: 0 };
    }

    let resolved = 0;
    let failed = 0;

    for (const entry of pending) {
      try {
        const walletData = await resolveFidToWallet(entry.fid);

        if (walletData.address) {
          await db.client
            .from("allowlist_entries")
            .update({
              wallet_address: walletData.address,
              username: walletData.username,
              display_name: walletData.displayName,
              wallet_resolved_at: new Date().toISOString(),
              metadata: walletData.pfpUrl ? { pfpUrl: walletData.pfpUrl } : {},
              updated_at: new Date().toISOString(),
            })
            .eq("id", entry.id);

          resolved++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
      }
    }

    console.log(
      `[Allowlist] Retry resolution: ${resolved} resolved, ${failed} failed`
    );
    return { resolved, failed };
  } catch (error) {
    console.error("[Allowlist] Error retrying resolutions:", error);
    return { resolved: 0, failed: 0 };
  }
}

export default {
  isAllowlistWindowOpen,
  addToAllowlist,
  removeFromAllowlist,
  isWalletAllowlisted,
  isFidAllowlisted,
  getAllowlistEntries,
  getAllowlistStats,
  updateAllowlistConfig,
  retryPendingWalletResolutions,
};
