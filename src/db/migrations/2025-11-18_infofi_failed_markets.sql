-- Migration: Create infofi_failed_markets table for tracking failed InfoFi market creation attempts
-- Date: 2025-11-18
-- Purpose: Persist failed gasless market creation attempts for admin visibility and manual recovery

CREATE TABLE IF NOT EXISTS infofi_failed_markets (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT,
  player_address VARCHAR(42) NOT NULL,
  source VARCHAR(20) DEFAULT 'UNKNOWN', -- 'LISTENER' | 'ADMIN' | 'UNKNOWN'
  error_message TEXT,
  attempts INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_infofi_failed_markets_season
  ON infofi_failed_markets (season_id);

CREATE INDEX IF NOT EXISTS idx_infofi_failed_markets_player
  ON infofi_failed_markets (player_address);

-- Enable Row Level Security for consistency
ALTER TABLE infofi_failed_markets ENABLE ROW LEVEL SECURITY;

-- Allow public read access (adjust as needed for your security model)
CREATE POLICY IF NOT EXISTS infofi_failed_markets_read ON infofi_failed_markets
  FOR SELECT USING (true);
