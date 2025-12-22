/**
 * NFT Drop API Routes
 * Admin and public endpoints for NFT drop management (Mint.Club mints and airdrops)
 */

import { db, hasSupabase } from "../../shared/supabaseClient.js";

/**
 * Register NFT drop routes
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function nftDropRoutes(fastify) {
  /**
   * GET /api/nft-drops
   * Get all active NFT drops
   * Query: ?type=mint|airdrop&featured=true
   */
  fastify.get("/", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const { type, featured, includeInactive } = request.query;

    try {
      let query = db()
        .from("nft_drops")
        .select("*")
        .order("created_at", { ascending: false });

      // Filter by active status (default: only active)
      if (includeInactive !== "true") {
        query = query.eq("is_active", true);
      }

      // Filter by type if specified
      if (type && (type === "mint" || type === "airdrop")) {
        query = query.eq("drop_type", type);
      }

      // Filter by featured if specified
      if (featured === "true") {
        query = query.eq("is_featured", true);
      }

      const { data, error } = await query;

      if (error) throw error;

      return reply.send({ drops: data || [] });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch NFT drops");
      return reply.code(500).send({ error: "Failed to fetch NFT drops" });
    }
  });

  /**
   * GET /api/nft-drops/:id
   * Get a specific NFT drop by ID
   */
  fastify.get("/:id", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const { id } = request.params;

    try {
      const { data, error } = await db()
        .from("nft_drops")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return reply.code(404).send({ error: "NFT drop not found" });
        }
        throw error;
      }

      return reply.send({ drop: data });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch NFT drop");
      return reply.code(500).send({ error: "Failed to fetch NFT drop" });
    }
  });

  /**
   * GET /api/nft-drops/active/current
   * Get currently active drops (within time window)
   */
  fastify.get("/active/current", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    try {
      const now = new Date().toISOString();

      const { data, error } = await db()
        .from("nft_drops")
        .select("*")
        .eq("is_active", true)
        .or(`start_time.is.null,start_time.lte.${now}`)
        .or(`end_time.is.null,end_time.gte.${now}`)
        .order("is_featured", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;

      return reply.send({ drops: data || [] });
    } catch (error) {
      fastify.log.error({ error }, "Failed to fetch active NFT drops");
      return reply
        .code(500)
        .send({ error: "Failed to fetch active NFT drops" });
    }
  });

  // ============ Admin Routes ============

  /**
   * POST /api/nft-drops/admin/create
   * Create a new NFT drop (admin only)
   */
  fastify.post("/admin/create", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const {
      name,
      description,
      network = "base",
      drop_type,
      nft_symbol,
      nft_contract_address,
      airdrop_id,
      requires_allowlist = true,
      start_time,
      end_time,
      is_active = true,
      is_featured = false,
      image_url,
      external_url,
      metadata = {},
      created_by,
    } = request.body;

    // Validation
    if (!name || typeof name !== "string") {
      return reply.code(400).send({ error: "name is required" });
    }

    if (!drop_type || !["mint", "airdrop"].includes(drop_type)) {
      return reply
        .code(400)
        .send({ error: "drop_type must be 'mint' or 'airdrop'" });
    }

    if (drop_type === "mint" && !nft_symbol) {
      return reply
        .code(400)
        .send({ error: "nft_symbol is required for mint drops" });
    }

    if (drop_type === "airdrop" && !airdrop_id) {
      return reply
        .code(400)
        .send({ error: "airdrop_id is required for airdrop drops" });
    }

    try {
      const { data, error } = await db()
        .from("nft_drops")
        .insert({
          name,
          description,
          network,
          drop_type,
          nft_symbol: drop_type === "mint" ? nft_symbol : null,
          nft_contract_address:
            drop_type === "mint" ? nft_contract_address : null,
          airdrop_id: drop_type === "airdrop" ? airdrop_id : null,
          requires_allowlist,
          start_time: start_time || null,
          end_time: end_time || null,
          is_active,
          is_featured,
          image_url,
          external_url,
          metadata,
          created_by,
        })
        .select()
        .single();

      if (error) throw error;

      fastify.log.info(
        { dropId: data.id, name, drop_type },
        "NFT drop created"
      );

      return reply.code(201).send({ drop: data });
    } catch (error) {
      fastify.log.error({ error }, "Failed to create NFT drop");
      return reply.code(500).send({ error: "Failed to create NFT drop" });
    }
  });

  /**
   * PUT /api/nft-drops/admin/:id
   * Update an NFT drop (admin only)
   */
  fastify.put("/admin/:id", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const { id } = request.params;
    const updates = request.body;

    // Remove fields that shouldn't be updated directly
    delete updates.id;
    delete updates.created_at;

    // Add updated_at
    updates.updated_at = new Date().toISOString();

    try {
      const { data, error } = await db()
        .from("nft_drops")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return reply.code(404).send({ error: "NFT drop not found" });
        }
        throw error;
      }

      fastify.log.info({ dropId: id }, "NFT drop updated");

      return reply.send({ drop: data });
    } catch (error) {
      fastify.log.error({ error }, "Failed to update NFT drop");
      return reply.code(500).send({ error: "Failed to update NFT drop" });
    }
  });

  /**
   * DELETE /api/nft-drops/admin/:id
   * Delete an NFT drop (admin only) - soft delete by setting is_active = false
   */
  fastify.delete("/admin/:id", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const { id } = request.params;
    const { hard } = request.query;

    try {
      if (hard === "true") {
        // Hard delete
        const { error } = await db().from("nft_drops").delete().eq("id", id);

        if (error) throw error;

        fastify.log.info({ dropId: id }, "NFT drop hard deleted");
      } else {
        // Soft delete
        const { error } = await db()
          .from("nft_drops")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", id);

        if (error) throw error;

        fastify.log.info({ dropId: id }, "NFT drop soft deleted");
      }

      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error({ error }, "Failed to delete NFT drop");
      return reply.code(500).send({ error: "Failed to delete NFT drop" });
    }
  });

  /**
   * POST /api/nft-drops/admin/:id/toggle-active
   * Toggle active status of an NFT drop
   */
  fastify.post("/admin/:id/toggle-active", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const { id } = request.params;

    try {
      // Get current status
      const { data: current, error: fetchError } = await db()
        .from("nft_drops")
        .select("is_active")
        .eq("id", id)
        .single();

      if (fetchError) {
        if (fetchError.code === "PGRST116") {
          return reply.code(404).send({ error: "NFT drop not found" });
        }
        throw fetchError;
      }

      // Toggle
      const { data, error } = await db()
        .from("nft_drops")
        .update({
          is_active: !current.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      fastify.log.info(
        { dropId: id, is_active: data.is_active },
        "NFT drop active status toggled"
      );

      return reply.send({ drop: data });
    } catch (error) {
      fastify.log.error({ error }, "Failed to toggle NFT drop status");
      return reply
        .code(500)
        .send({ error: "Failed to toggle NFT drop status" });
    }
  });

  /**
   * POST /api/nft-drops/admin/:id/toggle-featured
   * Toggle featured status of an NFT drop
   */
  fastify.post("/admin/:id/toggle-featured", async (request, reply) => {
    if (!hasSupabase()) {
      return reply.code(503).send({ error: "Database not configured" });
    }

    const { id } = request.params;

    try {
      // Get current status
      const { data: current, error: fetchError } = await db()
        .from("nft_drops")
        .select("is_featured")
        .eq("id", id)
        .single();

      if (fetchError) {
        if (fetchError.code === "PGRST116") {
          return reply.code(404).send({ error: "NFT drop not found" });
        }
        throw fetchError;
      }

      // Toggle
      const { data, error } = await db()
        .from("nft_drops")
        .update({
          is_featured: !current.is_featured,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      fastify.log.info(
        { dropId: id, is_featured: data.is_featured },
        "NFT drop featured status toggled"
      );

      return reply.send({ drop: data });
    } catch (error) {
      fastify.log.error({ error }, "Failed to toggle NFT drop featured status");
      return reply
        .code(500)
        .send({ error: "Failed to toggle NFT drop featured status" });
    }
  });
}
