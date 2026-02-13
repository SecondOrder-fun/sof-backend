/**
 * Access Groups Routes
 * Handles group management and user-group assignments
 */

import {
  createGroup,
  getAllGroups,
  getGroupBySlug,
  updateGroup,
  deleteGroup,
  addUserToGroup,
  removeUserFromGroup,
  getUserGroups,
  getGroupMembers,
  isUserInGroup,
} from "../../shared/groupService.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";

export default async function groupRoutes(fastify) {
  const requireAdmin = createRequireAdmin();

  /**
   * POST /groups
   * Create a new access group (admin only)
   * Body: { slug: string, name: string, description?: string }
   */
  fastify.post(
    "/groups",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { slug, name, description } = request.body;

      if (!slug || !name) {
        return reply.code(400).send({
          error: "slug and name are required",
        });
      }

      try {
        const result = await createGroup({ slug, name, description });

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to create group",
          });
        }

        return {
          success: true,
          group: result.group,
        };
      } catch (error) {
        fastify.log.error("Error creating group:", error);
        return reply.code(500).send({
          error: "Failed to create group",
        });
      }
    },
  );

  /**
   * GET /groups
   * List all access groups
   * Query params: activeOnly (boolean, default: true)
   */
  fastify.get("/groups", async (request, reply) => {
    const { activeOnly = "true" } = request.query;

    try {
      const result = await getAllGroups(activeOnly === "true");

      return {
        groups: result.groups,
      };
    } catch (error) {
      fastify.log.error("Error getting groups:", error);
      return reply.code(500).send({
        error: "Failed to get groups",
      });
    }
  });

  /**
   * GET /groups/:slug
   * Get a specific group by slug
   */
  fastify.get("/groups/:slug", async (request, reply) => {
    const { slug } = request.params;

    try {
      const group = await getGroupBySlug(slug);

      if (!group) {
        return reply.code(404).send({
          error: "Group not found",
        });
      }

      return group;
    } catch (error) {
      fastify.log.error("Error getting group:", error);
      return reply.code(500).send({
        error: "Failed to get group",
      });
    }
  });

  /**
   * PATCH /groups/:slug
   * Update a group (admin only)
   * Body: { name?: string, description?: string, isActive?: boolean }
   */
  fastify.patch(
    "/groups/:slug",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { slug } = request.params;
      const updates = request.body;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({
          error: "No updates provided",
        });
      }

      try {
        const result = await updateGroup(slug, updates);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to update group",
          });
        }

        return {
          success: true,
          group: result.group,
        };
      } catch (error) {
        fastify.log.error("Error updating group:", error);
        return reply.code(500).send({
          error: "Failed to update group",
        });
      }
    },
  );

  /**
   * DELETE /groups/:slug
   * Delete a group (soft delete) (admin only)
   */
  fastify.delete(
    "/groups/:slug",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { slug } = request.params;

      try {
        const result = await deleteGroup(slug);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to delete group",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error deleting group:", error);
        return reply.code(500).send({
          error: "Failed to delete group",
        });
      }
    },
  );

  /**
   * POST /groups/assign
   * Add user to a group (admin only)
   * Body: { fid?: number, wallet?: string, groupSlug: string, expiresAt?: string, grantedBy?: string }
   */
  fastify.post(
    "/groups/assign",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { fid, wallet, groupSlug, expiresAt, grantedBy } = request.body;

      if ((!fid && !wallet) || !groupSlug) {
        return reply.code(400).send({
          error: "groupSlug and either fid or wallet are required",
        });
      }

      try {
        const identifier = { fid: fid ? Number(fid) : undefined, wallet };
        const result = await addUserToGroup(identifier, groupSlug, {
          expiresAt,
          grantedBy,
        });

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to add user to group",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error adding user to group:", error);
        return reply.code(500).send({
          error: "Failed to add user to group",
        });
      }
    },
  );

  /**
   * POST /groups/remove
   * Remove user from a group (admin only)
   * Body: { fid?: number, wallet?: string, groupSlug: string }
   */
  fastify.post(
    "/groups/remove",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { fid, wallet, groupSlug } = request.body;

      if ((!fid && !wallet) || !groupSlug) {
        return reply.code(400).send({
          error: "groupSlug and either fid or wallet are required",
        });
      }

      try {
        const identifier = { fid: fid ? Number(fid) : undefined, wallet };
        const result = await removeUserFromGroup(identifier, groupSlug);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to remove user from group",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error removing user from group:", error);
        return reply.code(500).send({
          error: "Failed to remove user from group",
        });
      }
    },
  );

  /**
   * GET /groups/:slug/members
   * Get all members of a group
   */
  fastify.get("/groups/:slug/members", async (request, reply) => {
    const { slug } = request.params;

    try {
      const result = await getGroupMembers(slug);

      return {
        members: result.users,
      };
    } catch (error) {
      fastify.log.error("Error getting group members:", error);
      return reply.code(500).send({
        error: "Failed to get group members",
      });
    }
  });

  /**
   * GET /user-groups/:fid
   * Get all groups a user belongs to (backward compat for FID-based lookup)
   */
  fastify.get("/user-groups/:fid", async (request, reply) => {
    const { fid } = request.params;

    try {
      const result = await getUserGroups(parseInt(fid, 10));

      return {
        groups: result.groups,
      };
    } catch (error) {
      fastify.log.error("Error getting user groups:", error);
      return reply.code(500).send({
        error: "Failed to get user groups",
      });
    }
  });

  /**
   * GET /user-groups
   * Get all groups a user belongs to (supports wallet query param)
   * Query params: fid? (number), wallet? (string)
   */
  fastify.get("/user-groups", async (request, reply) => {
    const { fid, wallet } = request.query;

    if (!fid && !wallet) {
      return reply.code(400).send({
        error: "Either fid or wallet query parameter is required",
      });
    }

    try {
      const identifier = { fid: fid ? parseInt(fid, 10) : undefined, wallet };
      const result = await getUserGroups(identifier);

      return {
        groups: result.groups,
      };
    } catch (error) {
      fastify.log.error("Error getting user groups:", error);
      return reply.code(500).send({
        error: "Failed to get user groups",
      });
    }
  });

  /**
   * GET /check-membership
   * Check if user is in a specific group
   * Query params: fid? (number), wallet? (string), groupSlug (string)
   */
  fastify.get("/check-membership", async (request, reply) => {
    const { fid, wallet, groupSlug } = request.query;

    if ((!fid && !wallet) || !groupSlug) {
      return reply.code(400).send({
        error: "groupSlug and either fid or wallet are required",
      });
    }

    try {
      const identifier = { fid: fid ? parseInt(fid, 10) : undefined, wallet };
      const isMember = await isUserInGroup(identifier, groupSlug);

      return {
        isMember,
      };
    } catch (error) {
      fastify.log.error("Error checking group membership:", error);
      return reply.code(500).send({
        error: "Failed to check group membership",
      });
    }
  });
}
