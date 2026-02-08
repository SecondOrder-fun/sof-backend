/**
 * @file blockCursor.js
 * @description Persistent block cursor for event listeners.
 *
 * Stores lastProcessedBlock per listener key so that on restart the poller
 * resumes from where it left off instead of re-scanning from "now".
 *
 * Backend: Supabase `listener_block_cursors` table.
 *
 * Usage:
 *   const cursor = await createBlockCursor("0xABC:SeasonStarted");
 *   const lastBlock = await cursor.get();     // bigint | null
 *   await cursor.set(12345n);
 */

import { supabase, hasSupabase } from "../../shared/supabaseClient.js";

/**
 * Create a block cursor for a given listener key.
 *
 * @param {string} listenerKey — unique key, e.g. `${address}:${eventName}`
 * @returns {Promise<{ get: () => Promise<bigint|null>, set: (block: bigint) => Promise<void> }>}
 */
export async function createBlockCursor(listenerKey) {
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
