-- Migration: Create season_contracts table for storing BondingCurve and RaffleToken addresses
-- Purpose: Persist contract addresses retrieved from SeasonStarted events
-- Date: 2025-10-25

CREATE TABLE IF NOT EXISTS season_contracts (
  id BIGSERIAL PRIMARY KEY,
  season_id BIGINT NOT NULL UNIQUE,
  bonding_curve_address VARCHAR(42) NOT NULL,
  raffle_token_address VARCHAR(42) NOT NULL,
  raffle_address VARCHAR(42) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by season_id
CREATE INDEX IF NOT EXISTS idx_season_contracts_season_id 
  ON season_contracts(season_id);

-- Index for finding active seasons
CREATE INDEX IF NOT EXISTS idx_season_contracts_active 
  ON season_contracts(is_active) WHERE is_active = TRUE;

-- Index for bonding curve address lookups
CREATE INDEX IF NOT EXISTS idx_season_contracts_bonding_curve 
  ON season_contracts(bonding_curve_address);

-- Index for raffle token address lookups
CREATE INDEX IF NOT EXISTS idx_season_contracts_token 
  ON season_contracts(raffle_token_address);

-- Enable Row Level Security for consistency with other tables
ALTER TABLE season_contracts ENABLE ROW LEVEL SECURITY;

-- Allow public read access (adjust as needed for your security model)
CREATE POLICY "season_contracts_read" ON season_contracts
  FOR SELECT USING (true);

-- Allow service role to write
CREATE POLICY "season_contracts_write" ON season_contracts
  FOR INSERT WITH CHECK (true);

-- Allow service role to update
CREATE POLICY "season_contracts_update" ON season_contracts
  FOR UPDATE USING (true);
