/**
 * Route Configuration Routes
 * Handles route access configuration management
 */

import {
  upsertRouteConfig,
  setRoutePublicOverride,
  setRouteDisabled,
  getAllRouteConfigs,
  getRouteConfigByPattern,
  getRouteConfigByResource,
  deleteRouteConfig,
  getAccessSettings,
  updateAccessSetting,
} from "../../shared/routeConfigService.js";
import { createRequireAdmin } from "../../shared/adminGuard.js";

export default async function routeConfigRoutes(fastify) {
  const requireAdmin = createRequireAdmin();

  /**
   * POST /route-config
   * Create or update route access configuration (admin only)
   * Body: { routePattern, resourceType?, resourceId?, requiredLevel?, requiredGroups?, requireAllGroups?, isPublic?, isDisabled?, name?, description?, priority? }
   */
  fastify.post(
    "/route-config",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const config = request.body;

      if (!config.routePattern) {
        return reply.code(400).send({
          error: "routePattern is required",
        });
      }

      try {
        const result = await upsertRouteConfig(config);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to save route config",
          });
        }

        return {
          success: true,
          config: result.config,
        };
      } catch (error) {
        fastify.log.error("Error saving route config:", error);
        return reply.code(500).send({
          error: "Failed to save route config",
        });
      }
    },
  );

  /**
   * GET /route-configs
   * Get all route configurations (admin only)
   * Query params: resourceType?, isPublic?, isDisabled?
   */
  fastify.get(
    "/route-configs",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { resourceType, isPublic, isDisabled } = request.query;

      const filters = {};
      if (resourceType) filters.resourceType = resourceType;
      if (isPublic !== undefined) filters.isPublic = isPublic === "true";
      if (isDisabled !== undefined) filters.isDisabled = isDisabled === "true";

      try {
        const result = await getAllRouteConfigs(filters);

        return {
          configs: result.configs,
        };
      } catch (error) {
        fastify.log.error("Error getting route configs:", error);
        return reply.code(500).send({
          error: "Failed to get route configs",
        });
      }
    },
  );

  /**
   * GET /route-config/:pattern
   * Get route configuration by pattern (admin only)
   */
  fastify.get(
    "/route-config/:pattern",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { pattern } = request.params;

      try {
        const config = await getRouteConfigByPattern(pattern);

        if (!config) {
          return reply.code(404).send({
            error: "Route config not found",
          });
        }

        return config;
      } catch (error) {
        fastify.log.error("Error getting route config:", error);
        return reply.code(500).send({
          error: "Failed to get route config",
        });
      }
    },
  );

  /**
   * POST /set-public-override
   * Set a route to fully public or remove override (admin only)
   * Body: { routePattern: string, isPublic: boolean }
   */
  fastify.post(
    "/set-public-override",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { routePattern, isPublic } = request.body;

      if (!routePattern || isPublic === undefined) {
        return reply.code(400).send({
          error: "routePattern and isPublic are required",
        });
      }

      try {
        const result = await setRoutePublicOverride(routePattern, isPublic);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to set public override",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error setting public override:", error);
        return reply.code(500).send({
          error: "Failed to set public override",
        });
      }
    },
  );

  /**
   * POST /set-disabled
   * Set route disabled state (maintenance mode) (admin only)
   * Body: { routePattern: string, isDisabled: boolean }
   */
  fastify.post(
    "/set-disabled",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { routePattern, isDisabled } = request.body;

      if (!routePattern || isDisabled === undefined) {
        return reply.code(400).send({
          error: "routePattern and isDisabled are required",
        });
      }

      try {
        const result = await setRouteDisabled(routePattern, isDisabled);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to set disabled state",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error setting disabled state:", error);
        return reply.code(500).send({
          error: "Failed to set disabled state",
        });
      }
    },
  );

  /**
   * DELETE /route-config/:pattern
   * Delete route configuration (admin only)
   */
  fastify.delete(
    "/route-config/:pattern",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { pattern } = request.params;

      try {
        const result = await deleteRouteConfig(pattern);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to delete route config",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error deleting route config:", error);
        return reply.code(500).send({
          error: "Failed to delete route config",
        });
      }
    },
  );

  /**
   * GET /settings
   * Get all access settings (admin only)
   */
  fastify.get(
    "/settings",
    { preHandler: requireAdmin },
    async (request, reply) => {
      try {
        const result = await getAccessSettings();

        return result;
      } catch (error) {
        fastify.log.error("Error getting settings:", error);
        return reply.code(500).send({
          error: "Failed to get settings",
        });
      }
    },
  );

  /**
   * POST /settings
   * Update access settings (admin only)
   * Body: { key: string, value: any, updatedBy?: string }
   */
  fastify.post(
    "/settings",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { key, value, updatedBy } = request.body;

      if (!key || value === undefined) {
        return reply.code(400).send({
          error: "key and value are required",
        });
      }

      try {
        const result = await updateAccessSetting(key, value, updatedBy);

        if (!result.success) {
          return reply.code(400).send({
            error: result.error || "Failed to update setting",
          });
        }

        return {
          success: true,
        };
      } catch (error) {
        fastify.log.error("Error updating setting:", error);
        return reply.code(500).send({
          error: "Failed to update setting",
        });
      }
    },
  );
}
