/**
 * @file blockCursor.js
 * @description Persistent block cursor for event listeners.
 *
 * Stores lastProcessedBlock per listener key so that on restart the poller
 * resumes from where it left off instead of re-scanning from "now".
 *
 * Supports two backends (tried in order):
 *   1. Redis (Upstash) — preferred, fast
 *   2. Supabase `listener_block_cursors` table — fallback
 *
 * Usage:
 *   const cursor = await createBlockCursor("0xABC:SeasonStarted");
 *   const lastBlock = await cursor.get();     // bigint | null
 *   await cursor.set(12345n);
 */

import { redisClient } from "../../shared/redisClient.js";
import { supabase, hasSupabase } from "../../shared/supabaseClient.js";

const REDIS_PREFIX = "sof:block_cursor:";

/**
 * Try to obtain a connected Redis client. Returns null on failure.
 */
async function tryGetRedis() {
  try {
    if (!redisClient.isConnected && !redisClient.client) {
      // Attempt to connect if not already connected
      try {
        redisClient.connect();
      } catch {
        return null;
      }
    }
    const redis = redisClient.client;
    if (!redis) return null;
    if (redis.status === "ready") return redis;
    // ioredis may still be connecting; give it a moment
    if (redis.status === "connecting" || redis.status === "connect") {
      await new Promise((r) => setTimeout(r, 2000));
      if (redis.status === "ready") return redis;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a block cursor for a given listener key.
 *
 * @param {string} listenerKey — unique key, e.g. `${address}:${eventName}`
 * @returns {Promise<{ get: () => Promise<bigint|null>, set: (block: bigint) => Promise<void> }>}
 */
export async function createBlockCursor(listenerKey) {
  // ------- Redis backend -------
  const redis = await tryGetRedis();

  if (redis) {
    const redisKey = `${REDIS_PREFIX}${listenerKey}`;
    return {
      async get() {
        try {
          const val = await redis.get(redisKey);
          return val !== null && val !== undefined ? BigInt(val) : null;
        } catch {
          return null;
        }
      },
      async set(block) {
        try {
          await redis.set(redisKey, block.toString());
        } catch {
          // Swallow — best-effort persistence
        }
      },
    };
  }

  // ------- Supabase fallback -------
  if (hasSupabase) {
    return {
      async get() {
        try {
          const { data, error } = await supabase
            .from("listener_block_cursors")
            .select("last_block")
            .eq("listener_key", listenerKey)
            .maybeSingle();

          if (error || !data) return null;
          return BigInt(data.last_block);
        } catch {
          return null;
        }
      },
      async set(block) {
        try {
          await supabase.from("listener_block_cursors").upsert(
            {
              listener_key: listenerKey,
              last_block: Number(block), // Supabase bigint column accepts number
              updated_at: new Date().toISOString(),
            },
            { onConflict: "listener_key" },
          );
        } catch {
          // Swallow — best-effort persistence
        }
      },
    };
  }

  // ------- No persistence available — in-memory only -------
  let memBlock = null;
  return {
    async get() {
      return memBlock;
    },
    async set(block) {
      memBlock = block;
    },
  };
}
