import { supabase } from "./supabaseClient.js";

// Access level constants
export const ACCESS_LEVELS = {
  PUBLIC: 0,
  CONNECTED: 1,
  ALLOWLIST: 2,
  BETA: 3,
  ADMIN: 4,
};

export const ACCESS_LEVEL_NAMES = {
  0: "public",
  1: "connected",
  2: "allowlist",
  3: "beta",
  4: "admin",
};

/**
 * Get user's access info by FID (priority) or wallet
 * @param {object} params - { fid?, wallet? }
 * @returns {Promise<{level: number, levelName: string, groups: string[], entry: object|null}>}
 */
export async function getUserAccess({ fid, wallet }) {
  try {
    let entry = null;

    // Priority 1: Try FID lookup
    if (fid) {
      const { data, error } = await supabase
        .from("allowlist_entries")
        .select("*")
        .eq("fid", fid)
        .eq("is_active", true)
        .single();

      if (!error && data) {
        entry = data;
      }
    }

    // Priority 2: Fallback to wallet lookup
    if (!entry && wallet) {
      const { data, error } = await supabase
        .from("allowlist_entries")
        .select("*")
        .eq("wallet_address", wallet.toLowerCase())
        .eq("is_active", true)
        .single();

      if (!error && data) {
        entry = data;
      }
    }

    // If no entry found, return public access
    if (!entry) {
      return {
        level: ACCESS_LEVELS.PUBLIC,
        levelName: ACCESS_LEVEL_NAMES[ACCESS_LEVELS.PUBLIC],
        groups: [],
        entry: null,
      };
    }

    // Get user's groups
    const groups = await getUserGroups({ fid: entry.fid, wallet: entry.wallet_address });

    return {
      level: entry.access_level ?? ACCESS_LEVELS.ALLOWLIST,
      levelName:
        ACCESS_LEVEL_NAMES[entry.access_level ?? ACCESS_LEVELS.ALLOWLIST],
      groups,
      entry,
    };
  } catch (error) {
    console.error("Error getting user access:", error);
    return {
      level: ACCESS_LEVELS.PUBLIC,
      levelName: ACCESS_LEVEL_NAMES[ACCESS_LEVELS.PUBLIC],
      groups: [],
      entry: null,
    };
  }
}

/**
 * Check if user can access a route/resource
 * @param {object} params - { fid?, wallet?, route, resourceType?, resourceId? }
 * @returns {Promise<{hasAccess: boolean, reason: string, userLevel: number, requiredLevel: number, requiredGroups: string[], userGroups: string[], isPublicOverride: boolean, isDisabled: boolean, routeConfig: object|null}>}
 */
export async function checkRouteAccess({
  fid,
  wallet,
  route,
  resourceType,
  resourceId,
}) {
  try {
    // Get user's access info
    const userAccess = await getUserAccess({ fid, wallet });

    // Get route configuration
    const routeConfig = await getRouteConfig(route, resourceType, resourceId);

    // If no route config found, default to allowlist level (2)
    const requiredLevel =
      routeConfig?.required_level ?? ACCESS_LEVELS.ALLOWLIST;
    const requiredGroups = routeConfig?.required_groups ?? [];
    const requireAllGroups = routeConfig?.require_all_groups ?? false;
    const isPublicOverride = routeConfig?.is_public ?? false;
    const isDisabled = routeConfig?.is_disabled ?? false;

    // Check if route is disabled (maintenance mode)
    if (isDisabled) {
      return {
        hasAccess: false,
        reason: "disabled",
        userLevel: userAccess.level,
        requiredLevel,
        requiredGroups,
        userGroups: userAccess.groups,
        isPublicOverride,
        isDisabled,
        routeConfig,
      };
    }

    // Check if route has public override
    if (isPublicOverride) {
      return {
        hasAccess: true,
        reason: "public_override",
        userLevel: userAccess.level,
        requiredLevel,
        requiredGroups,
        userGroups: userAccess.groups,
        isPublicOverride,
        isDisabled,
        routeConfig,
      };
    }

    // Check access level
    if (userAccess.level < requiredLevel) {
      return {
        hasAccess: false,
        reason: "insufficient_level",
        userLevel: userAccess.level,
        requiredLevel,
        requiredGroups,
        userGroups: userAccess.groups,
        isPublicOverride,
        isDisabled,
        routeConfig,
      };
    }

    // Check group requirements if any
    if (requiredGroups.length > 0) {
      const hasRequiredGroups = requireAllGroups
        ? requiredGroups.every((group) => userAccess.groups.includes(group))
        : requiredGroups.some((group) => userAccess.groups.includes(group));

      if (!hasRequiredGroups) {
        return {
          hasAccess: false,
          reason: "missing_groups",
          userLevel: userAccess.level,
          requiredLevel,
          requiredGroups,
          userGroups: userAccess.groups,
          isPublicOverride,
          isDisabled,
          routeConfig,
        };
      }
    }

    // Access granted
    return {
      hasAccess: true,
      reason: "level_met",
      userLevel: userAccess.level,
      requiredLevel,
      requiredGroups,
      userGroups: userAccess.groups,
      isPublicOverride,
      isDisabled,
      routeConfig,
    };
  } catch (error) {
    console.error("Error checking route access:", error);
    return {
      hasAccess: false,
      reason: "error",
      userLevel: ACCESS_LEVELS.PUBLIC,
      requiredLevel: ACCESS_LEVELS.ALLOWLIST,
      requiredGroups: [],
      userGroups: [],
      isPublicOverride: false,
      isDisabled: false,
      routeConfig: null,
    };
  }
}

/**
 * Get route configuration
 * @param {string} route - Route pattern
 * @param {string} resourceType - Optional resource type
 * @param {string} resourceId - Optional resource ID
 * @returns {Promise<object|null>}
 */
export async function getRouteConfig(route, resourceType, resourceId) {
  try {
    let query = supabase.from("route_access_config").select("*");

    // Try exact match first with resource specificity
    if (resourceType && resourceId) {
      const { data } = await query
        .eq("route_pattern", route)
        .eq("resource_type", resourceType)
        .eq("resource_id", resourceId)
        .order("priority", { ascending: false })
        .limit(1)
        .single();

      if (data) return data;
    }

    // Try route pattern match
    const { data } = await query
      .eq("route_pattern", route)
      .order("priority", { ascending: false })
      .limit(1)
      .single();

    return data || null;
  } catch (error) {
    console.error("Error getting route config:", error);
    return null;
  }
}

/**
 * Set user's access level
 * @param {object|number} identifier - { fid?, wallet? } or FID number (backward compat)
 * @param {number} level - New access level (0-4)
 * @returns {Promise<{success: boolean, entry?: object}>}
 */
export async function setUserAccessLevel(identifier, level) {
  try {
    if (level < 0 || level > 4) {
      throw new Error("Invalid access level. Must be 0-4.");
    }

    // Backward compat: accept plain FID number
    const { fid, wallet } =
      typeof identifier === "object" ? identifier : { fid: identifier, wallet: undefined };

    if (!fid && !wallet) {
      throw new Error("Either fid or wallet is required");
    }

    let query = supabase
      .from("allowlist_entries")
      .update({ access_level: level, updated_at: new Date().toISOString() });

    if (fid) {
      query = query.eq("fid", fid);
    } else {
      query = query.eq("wallet_address", wallet.toLowerCase());
    }

    const { data, error } = await query.select().single();

    if (error) throw error;

    return { success: true, entry: data };
  } catch (error) {
    console.error("Error setting user access level:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get default access level for new entries
 * @returns {Promise<number>}
 */
export async function getDefaultAccessLevel() {
  try {
    const { data, error } = await supabase
      .from("access_settings")
      .select("value")
      .eq("key", "default_access_level")
      .single();

    if (error) throw error;

    return parseInt(data.value, 10);
  } catch (error) {
    console.error("Error getting default access level:", error);
    return ACCESS_LEVELS.ALLOWLIST; // Default fallback
  }
}

/**
 * Set default access level for new entries
 * @param {number} level - Default level (0-4)
 * @returns {Promise<{success: boolean}>}
 */
export async function setDefaultAccessLevel(level) {
  try {
    if (level < 0 || level > 4) {
      throw new Error("Invalid access level. Must be 0-4.");
    }

    const { error } = await supabase.from("access_settings").upsert({
      key: "default_access_level",
      value: level.toString(),
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error setting default access level:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's groups
 * @param {object|number} identifier - { fid?, wallet? } or FID number (backward compat)
 * @returns {Promise<string[]>}
 */
export async function getUserGroups(identifier) {
  try {
    const { fid, wallet } =
      typeof identifier === "object" ? identifier : { fid: identifier, wallet: undefined };

    if (!fid && !wallet) return [];

    let query = supabase
      .from("user_access_groups")
      .select("access_groups(slug)")
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (fid) {
      query = query.eq("fid", fid);
    } else {
      query = query.eq("wallet_address", wallet.toLowerCase());
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map((item) => item.access_groups.slug);
  } catch (error) {
    console.error("Error getting user groups:", error);
    return [];
  }
}
