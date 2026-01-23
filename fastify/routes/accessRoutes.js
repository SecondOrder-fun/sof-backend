/**
 * Access Control Routes
 * Handles access level checks, route access verification, and settings
 */

import {
  getUserAccess,
  checkRouteAccess,
  getRouteConfig,
  setUserAccessLevel,
  getDefaultAccessLevel,
  setDefaultAccessLevel,
  ACCESS_LEVELS,
  ACCESS_LEVEL_NAMES,
} from "../../shared/accessService.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";

export default async function accessRoutes(fastify) {
  const requireAdmin = createRequireAdmin();

  /**
   * GET /check
   * Check if a user is allowlisted and get their access info
   * Query params: fid (number, optional), wallet (string, optional)
   */
  fastify.get("/check", async (request, reply) => {
    const { fid, wallet } = request.query;

    if (!fid && !wallet) {
      return reply.code(400).send({
        error: "Either fid or wallet parameter is required",
      });
    }

    try {
      const accessInfo = await getUserAccess({
        fid: fid ? parseInt(fid, 10) : undefined,
        wallet,
      });

      return {
        isAllowlisted: accessInfo.level >= ACCESS_LEVELS.ALLOWLIST,
        accessLevel: accessInfo.level,
        levelName: accessInfo.levelName,
        groups: accessInfo.groups,
        entry: accessInfo.entry,
      };
    } catch (error) {
      fastify.log.error("Error checking user access:", error);
      return reply.code(500).send({
        error: "Failed to check user access",
      });
    }
  });

  /**
   * GET /check-access
   * Check if user can access a specific route/resource
   * Query params: fid?, wallet?, route (required), resourceType?, resourceId?
   */
  fastify.get("/check-access", async (request, reply) => {
    const { fid, wallet, route, resourceType, resourceId } = request.query;

    if (!route) {
      return reply.code(400).send({
        error: "route parameter is required",
      });
    }

    try {
      const accessCheck = await checkRouteAccess({
        fid: fid ? parseInt(fid, 10) : undefined,
        wallet,
        route,
        resourceType,
        resourceId,
      });

      return accessCheck;
    } catch (error) {
      fastify.log.error("Error checking route access:", error);
      return reply.code(500).send({
        error: "Failed to check route access",
      });
    }
  });

  /**
   * GET /route-config
   * Get access configuration for a route (public info only)
   * Query params: route (required)
   */
  fastify.get("/route-config", async (request, reply) => {
    const { route } = request.query;

    if (!route) {
      return reply.code(400).send({
        error: "route parameter is required",
      });
    }

    try {
      const config = await getRouteConfig(route);

      if (!config) {
        return reply.code(404).send({
          error: "Route configuration not found",
        });
      }

      return {
        route: config.route_pattern,
        requiredLevel: config.required_level,
        requiredLevelName: ACCESS_LEVEL_NAMES[config.required_level],
        requiresGroups: config.required_groups?.length > 0,
        requiredGroups: config.required_groups || [],
        requireAllGroups: config.require_all_groups,
        isPublic: config.is_public,
        isDisabled: config.is_disabled,
        name: config.name,
        description: config.description,
      };
    } catch (error) {
      fastify.log.error("Error getting route config:", error);
      return reply.code(500).send({
        error: "Failed to get route configuration",
      });
    }
  });

  /**
   * POST /set-access-level
   * Update a user's access level (admin only)
   * Body: { fid: number, accessLevel: number }
   */
  fastify.post(
    "/set-access-level",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { fid, accessLevel } = request.body;

      if (!fid || accessLevel === undefined) {
        return reply.code(400).send({
          error: "fid and accessLevel are required",
        });
      }

      if (accessLevel < 0 || accessLevel > 4) {
        return reply.code(400).send({
          error: "accessLevel must be between 0 and 4",
        });
      }

      try {
        const result = await setUserAccessLevel(fid, accessLevel);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to set access level",
          });
        }

        return {
          success: true,
          entry: result.entry,
        };
      } catch (error) {
        fastify.log.error("Error setting user access level:", error);
        return reply.code(500).send({
          error: "Failed to set user access level",
        });
      }
    },
  );

  /**
   * GET /default-level
   * Get the default access level for new entries
   */
  fastify.get("/default-level", async (request, reply) => {
    try {
      const level = await getDefaultAccessLevel();

      return {
        defaultLevel: level,
        levelName: ACCESS_LEVEL_NAMES[level],
      };
    } catch (error) {
      fastify.log.error("Error getting default access level:", error);
      return reply.code(500).send({
        error: "Failed to get default access level",
      });
    }
  });

  /**
   * POST /set-default-level
   * Set the default access level for new entries (admin only)
   * Body: { level: number }
   */
  fastify.post(
    "/set-default-level",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { level } = request.body;

      if (level === undefined) {
        return reply.code(400).send({
          error: "level is required",
        });
      }

      if (level < 0 || level > 4) {
        return reply.code(400).send({
          error: "level must be between 0 and 4",
        });
      }

      try {
        const result = await setDefaultAccessLevel(level);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to set default level",
          });
        }

        return {
          success: true,
          level,
          levelName: ACCESS_LEVEL_NAMES[level],
        };
      } catch (error) {
        fastify.log.error("Error setting default access level:", error);
        return reply.code(500).send({
          error: "Failed to set default access level",
        });
      }
    },
  );

  /**
   * GET /levels
   * Get all access level definitions
   */
  fastify.get("/levels", async (request, reply) => {
    return {
      levels: Object.entries(ACCESS_LEVELS).map(([name, value]) => ({
        name: name.toLowerCase(),
        value,
        displayName: ACCESS_LEVEL_NAMES[value],
      })),
    };
  });
}
