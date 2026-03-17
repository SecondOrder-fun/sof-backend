-- Migration: Change season_contracts unique constraint to (season_id, raffle_address)
-- Purpose: Allow the same season_id across different Raffle contract deployments
-- Date: 2026-03-17

-- Drop the old unique constraint on season_id alone
ALTER TABLE season_contracts DROP CONSTRAINT IF EXISTS season_contracts_season_id_key;

-- Add composite unique constraint
ALTER TABLE season_contracts ADD CONSTRAINT season_contracts_season_raffle_unique
  UNIQUE (season_id, raffle_address);

-- Clean up stale rows from old Raffle contract (0x03cCDb... was decommissioned)
-- These seasons (1, 2, 3) were from the pre-redeploy contract and are no longer active
DELETE FROM season_contracts
WHERE raffle_address = '0x03cCDb2381475954aB4D9ec4F4Fc1333b2F13d72';
