-- Migration: Add created_block to season_contracts
-- Purpose: Store the block number when season was created for efficient event queries
-- Date: 2026-02-06

ALTER TABLE season_contracts 
ADD COLUMN IF NOT EXISTS created_block BIGINT;

-- Index for block-based queries
CREATE INDEX IF NOT EXISTS idx_season_contracts_created_block 
  ON season_contracts(created_block);

COMMENT ON COLUMN season_contracts.created_block IS 'Block number when SeasonStarted event was emitted';
