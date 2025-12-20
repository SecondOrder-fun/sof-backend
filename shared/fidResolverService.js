/**
 * FID Resolver Service
 * Resolves Farcaster FIDs to primary wallet addresses
 * Uses Farcaster API with Neynar fallback
 */

import process from "node:process";

const FARCASTER_API_BASE = "https://api.farcaster.xyz";
const NEYNAR_API_BASE = "https://api.neynar.com/v2";

/**
 * Get primary Ethereum address for a Farcaster FID
 * @param {number} fid - Farcaster ID
 * @returns {Promise<{address: string|null, username?: string, displayName?: string, pfpUrl?: string}>}
 */
export async function resolveFidToWallet(fid) {
  if (!fid || typeof fid !== "number") {
    throw new Error("Invalid FID provided");
  }

  // Try Farcaster API first (no API key needed)
  try {
    const result = await resolveFidViaFarcasterApi(fid);
    if (result.address) {
      return result;
    }
  } catch (error) {
    console.warn(
      `[FID Resolver] Farcaster API failed for FID ${fid}:`,
      error.message
    );
  }

  // Fallback to Neynar API (requires API key)
  const neynarApiKey = process.env.NEYNAR_API_KEY;
  if (neynarApiKey) {
    try {
      const result = await resolveFidViaNeynar(fid, neynarApiKey);
      if (result.address) {
        return result;
      }
    } catch (error) {
      console.warn(
        `[FID Resolver] Neynar API failed for FID ${fid}:`,
        error.message
      );
    }
  }

  // Return null address if resolution failed
  return { address: null };
}

/**
 * Resolve FID using Farcaster's primary-address API
 * @param {number} fid
 * @returns {Promise<{address: string|null}>}
 */
async function resolveFidViaFarcasterApi(fid) {
  const url = `${FARCASTER_API_BASE}/fc/primary-address?fid=${fid}&protocol=ethereum`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Farcaster API returned ${response.status}`);
  }

  const data = await response.json();

  if (data.result?.address?.address) {
    return {
      address: data.result.address.address.toLowerCase(),
    };
  }

  return { address: null };
}

/**
 * Resolve FID using Neynar bulk user API
 * @param {number} fid
 * @param {string} apiKey
 * @returns {Promise<{address: string|null, username?: string, displayName?: string, pfpUrl?: string}>}
 */
async function resolveFidViaNeynar(fid, apiKey) {
  const url = `${NEYNAR_API_BASE}/farcaster/user/bulk?fids=${fid}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      api_key: apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Neynar API returned ${response.status}`);
  }

  const data = await response.json();
  const user = data.users?.[0];

  if (!user) {
    return { address: null };
  }

  // Get primary verified ETH address
  let address = null;

  // Check verified_addresses.primary first
  if (user.verified_addresses?.primary?.eth_address) {
    address = user.verified_addresses.primary.eth_address;
  }
  // Fallback to first verified ETH address
  else if (user.verified_addresses?.eth_addresses?.[0]) {
    address = user.verified_addresses.eth_addresses[0];
  }
  // Fallback to custody address
  else if (user.custody_address) {
    address = user.custody_address;
  }

  return {
    address: address?.toLowerCase() || null,
    username: user.username,
    displayName: user.display_name,
    pfpUrl: user.pfp_url,
  };
}

/**
 * Bulk resolve multiple FIDs to wallet addresses
 * @param {number[]} fids - Array of Farcaster IDs
 * @returns {Promise<Map<number, {address: string|null, username?: string, displayName?: string}>>}
 */
export async function bulkResolveFidsToWallets(fids) {
  const results = new Map();

  if (!fids || fids.length === 0) {
    return results;
  }

  const neynarApiKey = process.env.NEYNAR_API_KEY;

  // If we have Neynar API key, use bulk endpoint
  if (neynarApiKey) {
    try {
      const url = `${NEYNAR_API_BASE}/farcaster/user/bulk?fids=${fids.join(
        ","
      )}`;

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          api_key: neynarApiKey,
        },
      });

      if (response.ok) {
        const data = await response.json();

        for (const user of data.users || []) {
          let address = null;

          if (user.verified_addresses?.primary?.eth_address) {
            address = user.verified_addresses.primary.eth_address;
          } else if (user.verified_addresses?.eth_addresses?.[0]) {
            address = user.verified_addresses.eth_addresses[0];
          } else if (user.custody_address) {
            address = user.custody_address;
          }

          results.set(user.fid, {
            address: address?.toLowerCase() || null,
            username: user.username,
            displayName: user.display_name,
            pfpUrl: user.pfp_url,
          });
        }

        return results;
      }
    } catch (error) {
      console.warn(
        "[FID Resolver] Bulk Neynar resolution failed:",
        error.message
      );
    }
  }

  // Fallback to individual resolution
  for (const fid of fids) {
    try {
      const result = await resolveFidToWallet(fid);
      results.set(fid, result);
    } catch (error) {
      results.set(fid, { address: null });
    }
  }

  return results;
}

export default {
  resolveFidToWallet,
  bulkResolveFidsToWallets,
};
