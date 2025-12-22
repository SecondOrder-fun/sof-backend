/**
 * Allowlist API Routes
 * Admin and public endpoints for wallet-based allowlist management
 */

import {
  isAllowlistWindowOpen,
  addToAllowlist,
  removeFromAllowlist,
  isWalletAllowlisted,
  isFidAllowlisted,
  getAllowlistEntries,
  getAllowlistStats,
  updateAllowlistConfig,
  retryPendingWalletResolutions,
} from "../../shared/allowlistService.js";
import {
  resolveFidToWallet,
  bulkResolveFidsToWallets,
} from "../../shared/fidResolverService.js";
import { db, hasSupabase } from "../../shared/supabaseClient.js";

/**
 * Register allowlist routes
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function allowlistRoutes(fastify) {
  /**
   * GET /api/allowlist/check
   * Check if a wallet address is allowlisted
   * Query: ?wallet=0x...
   */
  fastify.get("/check", async (request, reply) => {
    const { wallet } = request.query;

    if (!wallet || typeof wallet !== "string") {
      return reply.code(400).send({ error: "wallet query parameter required" });
    }

    if (!wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
      return reply.code(400).send({ error: "Invalid wallet address format" });
    }

    try {
      const result = await isWalletAllowlisted(wallet);
      return reply.send({
        isAllowlisted: result.isAllowlisted,
        entry: result.entry || null,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to check allowlist");
      return reply.code(500).send({ error: "Failed to check allowlist" });
    }
  });

  /**
   * GET /api/allowlist/check-fid
   * Check if a FID is allowlisted
   * Query: ?fid=12345
   */
  fastify.get("/check-fid", async (request, reply) => {
    const { fid } = request.query;

    if (!fid) {
      return reply.code(400).send({ error: "fid query parameter required" });
    }

    const fidNum = Number(fid);
    if (!Number.isFinite(fidNum) || fidNum <= 0) {
      return reply.code(400).send({ error: "fid must be a positive number" });
    }

    try {
      const result = await isFidAllowlisted(fidNum);
      return reply.send({
        isAllowlisted: result.isAllowlisted,
        entry: result.entry || null,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to check allowlist by FID");
      return reply.code(500).send({ error: "Failed to check allowlist" });
    }
  });

  /**
   * GET /api/allowlist/window-status
   * Check if the allowlist window is currently open
   */
  fastify.get("/window-status", async (_request, reply) => {
    try {
      const result = await isAllowlistWindowOpen();
      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, "Failed to check allowlist window");
      return reply.code(500).send({ error: "Failed to check window status" });
    }
  });

  // ============ ADMIN ROUTES ============

  /**
   * GET /api/allowlist/stats
   * Get allowlist statistics (admin)
   */
  fastify.get("/stats", async (_request, reply) => {
    try {
      const stats = await getAllowlistStats();
      return reply.send(stats);
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch allowlist stats");
      return reply.code(500).send({ error: "Failed to fetch stats" });
    }
  });

  /**
   * GET /api/allowlist/entries
   * Get all allowlist entries (admin)
   * Query: ?activeOnly=true&limit=100&includeUsernames=true
   */
  fastify.get("/entries", async (request, reply) => {
    const {
      activeOnly = "true",
      limit = "100",
      includeUsernames = "true",
    } = request.query;

    try {
      const result = await getAllowlistEntries({
        activeOnly: activeOnly !== "false",
        limit: Math.min(Number(limit) || 100, 500),
      });

      // Fetch Farcaster usernames if requested
      if (includeUsernames !== "false" && result.entries?.length > 0) {
        const fids = result.entries
          .filter((e) => e.fid && e.fid > 0)
          .map((e) => e.fid);

        if (fids.length > 0) {
          try {
            const userInfoMap = await bulkResolveFidsToWallets(fids);

            // Enrich entries with username info
            result.entries = result.entries.map((entry) => {
              const userInfo = userInfoMap.get(entry.fid);
              return {
                ...entry,
                username: userInfo?.username || null,
                displayName: userInfo?.displayName || null,
                pfpUrl: userInfo?.pfpUrl || null,
              };
            });
          } catch (userError) {
            fastify.log.warn(
              { error: userError.message },
              "Failed to fetch Farcaster usernames"
            );
          }
        }
      }

      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch allowlist entries");
      return reply.code(500).send({ error: "Failed to fetch entries" });
    }
  });

  /**
   * POST /api/allowlist/add
   * Manually add a user to the allowlist (admin)
   * Body: { fid: number } or { wallet: string }
   */
  fastify.post("/add", async (request, reply) => {
    const { fid, wallet } = request.body || {};

    try {
      if (fid) {
        // Add by FID
        const fidNum = Number(fid);
        if (!Number.isFinite(fidNum) || fidNum <= 0) {
          return reply
            .code(400)
            .send({ error: "fid must be a positive number" });
        }

        const result = await addToAllowlist(fidNum, "manual", true); // bypass time gate

        if (!result.success) {
          return reply.code(400).send({ error: result.error });
        }

        return reply.send({
          success: true,
          entry: result.entry,
          alreadyExists: result.alreadyExists || false,
          reactivated: result.reactivated || false,
        });
      } else if (wallet) {
        // Add by wallet address directly (no FID)
        if (!wallet.match(/^0x[a-fA-F0-9]{40}$/)) {
          return reply
            .code(400)
            .send({ error: "Invalid wallet address format" });
        }

        // Check if already exists
        const existing = await isWalletAllowlisted(wallet);
        if (existing.isAllowlisted) {
          return reply.send({
            success: true,
            entry: existing.entry,
            alreadyExists: true,
          });
        }

        // Insert directly with wallet (no FID)
        if (!hasSupabase) {
          return reply.code(503).send({ error: "Database not configured" });
        }

        const { data: entry, error } = await db.client
          .from("allowlist_entries")
          .insert({
            fid: 0, // Placeholder for wallet-only entries
            wallet_address: wallet.toLowerCase(),
            source: "manual",
            is_active: true,
            added_at: new Date().toISOString(),
            wallet_resolved_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) {
          return reply.code(500).send({ error: error.message });
        }

        return reply.send({ success: true, entry });
      } else {
        return reply
          .code(400)
          .send({ error: "Either fid or wallet is required" });
      }
    } catch (error) {
      fastify.log.error({ error }, "Failed to add to allowlist");
      return reply.code(500).send({ error: "Failed to add to allowlist" });
    }
  });

  /**
   * POST /api/allowlist/remove
   * Remove a user from the allowlist (admin, soft delete)
   * Body: { fid: number }
   */
  fastify.post("/remove", async (request, reply) => {
    const { fid } = request.body || {};

    if (!fid) {
      return reply.code(400).send({ error: "fid is required" });
    }

    const fidNum = Number(fid);
    if (!Number.isFinite(fidNum) || fidNum <= 0) {
      return reply.code(400).send({ error: "fid must be a positive number" });
    }

    try {
      const result = await removeFromAllowlist(fidNum);

      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }

      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, "Failed to remove from allowlist");
      return reply.code(500).send({ error: "Failed to remove from allowlist" });
    }
  });

  /**
   * POST /api/allowlist/config
   * Update allowlist window configuration (admin)
   * Body: { windowStart: ISO date, windowEnd: ISO date | null, maxEntries: number | null }
   */
  fastify.post("/config", async (request, reply) => {
    const { windowStart, windowEnd, maxEntries } = request.body || {};

    try {
      const result = await updateAllowlistConfig({
        windowStart: windowStart ? new Date(windowStart) : new Date(),
        windowEnd: windowEnd ? new Date(windowEnd) : null,
        maxEntries: maxEntries ? Number(maxEntries) : null,
      });

      if (!result.success) {
        return reply.code(400).send({ error: result.error });
      }

      return reply.send({ success: true, config: result.config });
    } catch (error) {
      fastify.log.error({ error }, "Failed to update allowlist config");
      return reply.code(500).send({ error: "Failed to update config" });
    }
  });

  /**
   * POST /api/allowlist/retry-resolutions
   * Retry wallet resolution for entries without wallets (admin)
   */
  fastify.post("/retry-resolutions", async (_request, reply) => {
    try {
      const result = await retryPendingWalletResolutions();
      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, "Failed to retry wallet resolutions");
      return reply.code(500).send({ error: "Failed to retry resolutions" });
    }
  });

  /**
   * POST /api/allowlist/resolve-fid
   * Resolve a FID to wallet address (admin utility)
   * Body: { fid: number }
   */
  fastify.post("/resolve-fid", async (request, reply) => {
    const { fid } = request.body || {};

    if (!fid) {
      return reply.code(400).send({ error: "fid is required" });
    }

    const fidNum = Number(fid);
    if (!Number.isFinite(fidNum) || fidNum <= 0) {
      return reply.code(400).send({ error: "fid must be a positive number" });
    }

    try {
      const result = await resolveFidToWallet(fidNum);
      return reply.send(result);
    } catch (error) {
      fastify.log.error({ error }, "Failed to resolve FID");
      return reply.code(500).send({ error: "Failed to resolve FID" });
    }
  });

  /**
   * POST /api/allowlist/import-from-notifications
   * Import all users from farcaster_notification_tokens to allowlist (admin)
   * This is a one-time migration helper
   */
  fastify.post("/import-from-notifications", async (_request, reply) => {
    if (!hasSupabase) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    try {
      // Get all unique FIDs from notification tokens
      const { data: tokens, error: fetchError } = await db.client
        .from("farcaster_notification_tokens")
        .select("fid")
        .order("created_at", { ascending: true });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const uniqueFids = [...new Set(tokens.map((t) => t.fid))];

      let added = 0;
      let skipped = 0;
      let failed = 0;

      for (const fid of uniqueFids) {
        try {
          const result = await addToAllowlist(fid, "import", true); // bypass time gate
          if (result.success) {
            if (result.alreadyExists) {
              skipped++;
            } else {
              added++;
            }
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      fastify.log.info(
        { added, skipped, failed, total: uniqueFids.length },
        "[Allowlist] Import from notifications complete"
      );

      return reply.send({
        success: true,
        total: uniqueFids.length,
        added,
        skipped,
        failed,
      });
    } catch (error) {
      fastify.log.error({ error }, "Failed to import from notifications");
      return reply.code(500).send({ error: "Failed to import" });
    }
  });
}
