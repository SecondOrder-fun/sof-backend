import { supabase } from "./supabaseClient.js";

/**
 * Create or update route configuration
 * @param {object} config - Route config object
 * @returns {Promise<{success: boolean, config?: object}>}
 */
export async function upsertRouteConfig(config) {
  try {
    const {
      routePattern,
      resourceType,
      resourceId,
      requiredLevel,
      requiredGroups,
      requireAllGroups,
      isPublic,
      isDisabled,
      name,
      description,
      priority,
    } = config;

    const { data, error } = await supabase
      .from("route_access_config")
      .upsert(
        {
          route_pattern: routePattern,
          resource_type: resourceType || null,
          resource_id: resourceId || null,
          required_level: requiredLevel ?? 2,
          required_groups: requiredGroups || [],
          require_all_groups: requireAllGroups ?? false,
          is_public: isPublic ?? false,
          is_disabled: isDisabled ?? false,
          name: name || null,
          description: description || null,
          priority: priority ?? 0,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "route_pattern",
        }
      )
      .select()
      .single();

    if (error) throw error;

    return { success: true, config: data };
  } catch (error) {
    console.error("Error upserting route config:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Set route public override
 * @param {string} routePattern - Route to update
 * @param {boolean} isPublic - Public override state
 * @returns {Promise<{success: boolean}>}
 */
export async function setRoutePublicOverride(routePattern, isPublic) {
  try {
    const { error } = await supabase
      .from("route_access_config")
      .update({
        is_public: isPublic,
        updated_at: new Date().toISOString(),
      })
      .eq("route_pattern", routePattern);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error setting route public override:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Set route disabled state (maintenance mode)
 * @param {string} routePattern - Route to update
 * @param {boolean} isDisabled - Disabled state
 * @returns {Promise<{success: boolean}>}
 */
export async function setRouteDisabled(routePattern, isDisabled) {
  try {
    const { error } = await supabase
      .from("route_access_config")
      .update({
        is_disabled: isDisabled,
        updated_at: new Date().toISOString(),
      })
      .eq("route_pattern", routePattern);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error setting route disabled state:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all route configurations
 * @param {object} filters - Optional filters { resourceType?, isPublic?, isDisabled? }
 * @returns {Promise<{configs: object[]}>}
 */
export async function getAllRouteConfigs(filters = {}) {
  try {
    let query = supabase
      .from("route_access_config")
      .select("*")
      .order("priority", { ascending: false })
      .order("route_pattern", { ascending: true });

    if (filters.resourceType) {
      query = query.eq("resource_type", filters.resourceType);
    }

    if (filters.isPublic !== undefined) {
      query = query.eq("is_public", filters.isPublic);
    }

    if (filters.isDisabled !== undefined) {
      query = query.eq("is_disabled", filters.isDisabled);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { configs: data || [] };
  } catch (error) {
    console.error("Error getting route configs:", error);
    return { configs: [] };
  }
}

/**
 * Get route configuration by pattern
 * @param {string} routePattern - Route pattern
 * @returns {Promise<object|null>}
 */
export async function getRouteConfigByPattern(routePattern) {
  try {
    const { data, error } = await supabase
      .from("route_access_config")
      .select("*")
      .eq("route_pattern", routePattern)
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error("Error getting route config by pattern:", error);
    return null;
  }
}

/**
 * Get route configuration by resource
 * @param {string} resourceType - Resource type
 * @param {string} resourceId - Resource ID
 * @returns {Promise<object|null>}
 */
export async function getRouteConfigByResource(resourceType, resourceId) {
  try {
    const { data, error } = await supabase
      .from("route_access_config")
      .select("*")
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId)
      .order("priority", { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error("Error getting route config by resource:", error);
    return null;
  }
}

/**
 * Delete route configuration
 * @param {string} routePattern - Route to delete
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteRouteConfig(routePattern) {
  try {
    const { error } = await supabase
      .from("route_access_config")
      .delete()
      .eq("route_pattern", routePattern);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error deleting route config:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get access settings
 * @returns {Promise<{settings: object}>}
 */
export async function getAccessSettings() {
  try {
    const { data, error } = await supabase.from("access_settings").select("*");

    if (error) throw error;

    // Convert to key-value object
    const settings = {};
    data.forEach((item) => {
      settings[item.key] = item.value;
    });

    return { settings };
  } catch (error) {
    console.error("Error getting access settings:", error);
    return { settings: {} };
  }
}

/**
 * Update access setting
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 * @param {string} updatedBy - Who updated the setting
 * @returns {Promise<{success: boolean}>}
 */
export async function updateAccessSetting(key, value, updatedBy = "system") {
  try {
    const { error } = await supabase.from("access_settings").upsert({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error updating access setting:", error);
    return { success: false, error: error.message };
  }
}
