/**
 * FID Resolver Service
 * Resolves Farcaster FIDs to primary wallet addresses
 * Uses Farcaster API with Neynar fallback
 */

import process from "node:process";

const FARCASTER_API_BASE = "https://api.farcaster.xyz";
const FARCASTER_FNAME_API = "https://fnames.farcaster.xyz";
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
 * Get username for a FID using Farcaster FName Registry (no API key needed)
 * @param {number} fid
 * @returns {Promise<string|null>}
 */
async function getUsernameViaFnameRegistry(fid) {
  try {
    const url = `${FARCASTER_FNAME_API}/transfers?fid=${fid}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    // Get the most recent transfer (last in array) for this FID
    const transfers = data.transfers || [];
    if (transfers.length > 0) {
      // Find the transfer where this FID is the recipient (to field)
      const relevantTransfer = transfers.find((t) => t.to === fid);
      return relevantTransfer?.username || null;
    }
    return null;
  } catch {
    return null;
  }
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
 * Bulk resolve multiple FIDs to wallet addresses and usernames
 * Uses Farcaster FName Registry API (no key needed) with Neynar fallback
 * @param {number[]} fids - Array of Farcaster IDs
 * @returns {Promise<Map<number, {address: string|null, username?: string, displayName?: string}>>}
 */
export async function bulkResolveFidsToWallets(fids) {
  const results = new Map();

  if (!fids || fids.length === 0) {
    return results;
  }

  const neynarApiKey = process.env.NEYNAR_API_KEY;

  // If we have Neynar API key, use bulk endpoint (includes pfp, displayName)
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

  // Fallback: Use Farcaster FName Registry API for usernames (no API key needed)
  // and Farcaster primary-address API for wallet addresses
  console.log(
    `[FID Resolver] Using Farcaster APIs for ${fids.length} FIDs (no Neynar key)`
  );

  // Fetch usernames in parallel using FName Registry
  const usernamePromises = fids.map(async (fid) => {
    const username = await getUsernameViaFnameRegistry(fid);
    return { fid, username };
  });

  const usernameResults = await Promise.all(usernamePromises);
  const usernameMap = new Map(usernameResults.map((r) => [r.fid, r.username]));

  // Fetch wallet addresses in parallel
  for (const fid of fids) {
    try {
      const walletResult = await resolveFidToWallet(fid);
      results.set(fid, {
        address: walletResult.address,
        username: usernameMap.get(fid) || walletResult.username || null,
        displayName: walletResult.displayName || null,
        pfpUrl: walletResult.pfpUrl || null,
      });
    } catch {
      results.set(fid, {
        address: null,
        username: usernameMap.get(fid) || null,
      });
    }
  }

  return results;
}

export default {
  resolveFidToWallet,
  bulkResolveFidsToWallets,
};
