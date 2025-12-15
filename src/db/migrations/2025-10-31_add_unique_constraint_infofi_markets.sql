-- Migration: Add unique constraint for case-insensitive player addresses in infofi_markets
-- Date: 2025-10-31
-- Purpose: Prevent duplicate markets for the same player due to address case sensitivity

-- Drop existing constraint if it exists (for idempotency)
ALTER TABLE infofi_markets DROP CONSTRAINT IF EXISTS unique_season_player_market;

-- Add unique constraint using LOWER() for case-insensitive comparison
-- This ensures we can't have duplicate entries for the same player with different address casing
CREATE UNIQUE INDEX IF NOT EXISTS unique_season_player_market_idx 
ON infofi_markets (season_id, LOWER(player_address), market_type);

-- Add a comment explaining the constraint
COMMENT ON INDEX unique_season_player_market_idx IS 
'Ensures unique markets per season/player/type with case-insensitive address matching';
