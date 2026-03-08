-- Migration 013: Reset contract-dependent data for full redeployment
-- KEEPS: players, allowlist_entries, allowlist_config, farcaster_notification_tokens,
--        access_groups, user_access_groups, route_access_config, access_settings, nft_drops
-- RESETS: all positions, transactions, markets, listener cursors, season contracts

-- Order matters: truncate child tables before parents to avoid FK issues
TRUNCATE TABLE infofi_odds_history RESTART IDENTITY CASCADE;
TRUNCATE TABLE infofi_positions RESTART IDENTITY CASCADE;
TRUNCATE TABLE infofi_failed_markets RESTART IDENTITY CASCADE;
TRUNCATE TABLE infofi_markets RESTART IDENTITY CASCADE;
TRUNCATE TABLE raffle_transactions RESTART IDENTITY CASCADE;
TRUNCATE TABLE season_contracts RESTART IDENTITY CASCADE;
TRUNCATE TABLE listener_block_cursors RESTART IDENTITY CASCADE;

-- Refresh materialized views (will become empty)
-- Note: REFRESH MATERIALIZED VIEW doesn't support IF EXISTS, so wrap in DO block
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'user_raffle_positions') THEN
    REFRESH MATERIALIZED VIEW user_raffle_positions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'user_market_positions') THEN
    REFRESH MATERIALIZED VIEW user_market_positions;
  END IF;
END $$;
