import { supabase } from "./supabaseClient.js";

/**
 * Create an access group
 * @param {object} group - { slug, name, description? }
 * @returns {Promise<{success: boolean, group?: object}>}
 */
export async function createGroup({ slug, name, description }) {
  try {
    const { data, error } = await supabase
      .from("access_groups")
      .insert({
        slug,
        name,
        description,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    return { success: true, group: data };
  } catch (error) {
    console.error("Error creating group:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all access groups
 * @param {boolean} activeOnly - Only return active groups
 * @returns {Promise<{groups: object[]}>}
 */
export async function getAllGroups(activeOnly = true) {
  try {
    let query = supabase
      .from("access_groups")
      .select("*")
      .order("name", { ascending: true });

    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { groups: data || [] };
  } catch (error) {
    console.error("Error getting groups:", error);
    return { groups: [] };
  }
}

/**
 * Get group by slug
 * @param {string} slug - Group slug
 * @returns {Promise<object|null>}
 */
export async function getGroupBySlug(slug) {
  try {
    const { data, error } = await supabase
      .from("access_groups")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) throw error;

    return data;
  } catch (error) {
    console.error("Error getting group by slug:", error);
    return null;
  }
}

/**
 * Update group
 * @param {string} slug - Group slug
 * @param {object} updates - Fields to update
 * @returns {Promise<{success: boolean, group?: object}>}
 */
export async function updateGroup(slug, updates) {
  try {
    const { data, error } = await supabase
      .from("access_groups")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", slug)
      .select()
      .single();

    if (error) throw error;

    return { success: true, group: data };
  } catch (error) {
    console.error("Error updating group:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete group (soft delete by setting is_active to false)
 * @param {string} slug - Group slug
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteGroup(slug) {
  try {
    const { error } = await supabase
      .from("access_groups")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("slug", slug);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error deleting group:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Add user to group
 * @param {object|number} identifier - { fid?, wallet? } or FID number (backward compat)
 * @param {string} groupSlug - Group identifier
 * @param {object} options - { expiresAt?, grantedBy? }
 * @returns {Promise<{success: boolean}>}
 */
export async function addUserToGroup(identifier, groupSlug, options = {}) {
  try {
    const { fid, wallet } =
      typeof identifier === "object" ? identifier : { fid: identifier, wallet: undefined };

    if (!fid && !wallet) {
      throw new Error("Either fid or wallet is required");
    }

    // Get group ID from slug
    const group = await getGroupBySlug(groupSlug);
    if (!group) {
      throw new Error(`Group not found: ${groupSlug}`);
    }

    const insertRow = {
      fid: fid || null,
      wallet_address: wallet ? wallet.toLowerCase() : null,
      group_id: group.id,
      granted_by: options.grantedBy || "system",
      expires_at: options.expiresAt || null,
      is_active: true,
    };

    const { error } = await supabase
      .from("user_access_groups")
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      // If duplicate, update instead
      if (error.code === "23505") {
        let updateQuery = supabase
          .from("user_access_groups")
          .update({
            is_active: true,
            granted_by: options.grantedBy || "system",
            expires_at: options.expiresAt || null,
            granted_at: new Date().toISOString(),
          })
          .eq("group_id", group.id);

        if (fid) {
          updateQuery = updateQuery.eq("fid", fid);
        } else {
          updateQuery = updateQuery.eq("wallet_address", wallet.toLowerCase());
        }

        const { error: updateError } = await updateQuery;
        if (updateError) throw updateError;
        return { success: true };
      }
      throw error;
    }

    return { success: true };
  } catch (error) {
    console.error("Error adding user to group:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove user from group
 * @param {object|number} identifier - { fid?, wallet? } or FID number (backward compat)
 * @param {string} groupSlug - Group identifier
 * @returns {Promise<{success: boolean}>}
 */
export async function removeUserFromGroup(identifier, groupSlug) {
  try {
    const { fid, wallet } =
      typeof identifier === "object" ? identifier : { fid: identifier, wallet: undefined };

    if (!fid && !wallet) {
      throw new Error("Either fid or wallet is required");
    }

    // Get group ID from slug
    const group = await getGroupBySlug(groupSlug);
    if (!group) {
      throw new Error(`Group not found: ${groupSlug}`);
    }

    let query = supabase
      .from("user_access_groups")
      .update({ is_active: false })
      .eq("group_id", group.id);

    if (fid) {
      query = query.eq("fid", fid);
    } else {
      query = query.eq("wallet_address", wallet.toLowerCase());
    }

    const { error } = await query;

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("Error removing user from group:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's groups
 * @param {object|number} identifier - { fid?, wallet? } or FID number (backward compat)
 * @returns {Promise<{groups: string[]}>}
 */
export async function getUserGroups(identifier) {
  try {
    const { fid, wallet } =
      typeof identifier === "object" ? identifier : { fid: identifier, wallet: undefined };

    if (!fid && !wallet) return { groups: [] };

    let query = supabase
      .from("user_access_groups")
      .select("access_groups(slug, name)")
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (fid) {
      query = query.eq("fid", fid);
    } else {
      query = query.eq("wallet_address", wallet.toLowerCase());
    }

    const { data, error } = await query;

    if (error) throw error;

    return {
      groups: data.map((item) => ({
        slug: item.access_groups.slug,
        name: item.access_groups.name,
      })),
    };
  } catch (error) {
    console.error("Error getting user groups:", error);
    return { groups: [] };
  }
}

/**
 * Get users in a group
 * @param {string} groupSlug - Group identifier
 * @returns {Promise<{users: object[]}>}
 */
export async function getGroupMembers(groupSlug) {
  try {
    // Get group ID from slug
    const group = await getGroupBySlug(groupSlug);
    if (!group) {
      throw new Error(`Group not found: ${groupSlug}`);
    }

    const { data, error } = await supabase
      .from("user_access_groups")
      .select("fid, wallet_address, granted_at, granted_by, expires_at")
      .eq("group_id", group.id)
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("granted_at", { ascending: false });

    if (error) throw error;

    return { users: data || [] };
  } catch (error) {
    console.error("Error getting group members:", error);
    return { users: [] };
  }
}

/**
 * Check if user is in group
 * @param {object|number} identifier - { fid?, wallet? } or FID number (backward compat)
 * @param {string} groupSlug - Group identifier
 * @returns {Promise<boolean>}
 */
export async function isUserInGroup(identifier, groupSlug) {
  try {
    const { fid, wallet } =
      typeof identifier === "object" ? identifier : { fid: identifier, wallet: undefined };

    if (!fid && !wallet) return false;

    const group = await getGroupBySlug(groupSlug);
    if (!group) return false;

    let query = supabase
      .from("user_access_groups")
      .select("id")
      .eq("group_id", group.id)
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (fid) {
      query = query.eq("fid", fid);
    } else {
      query = query.eq("wallet_address", wallet.toLowerCase());
    }

    const { data, error } = await query.single();

    if (error) return false;

    return !!data;
  } catch (error) {
    console.error("Error checking user group membership:", error);
    return false;
  }
}
