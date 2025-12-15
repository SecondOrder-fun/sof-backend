-- Reset sequence functions for clearing test data
-- These are useful when resetting local Anvil and need to sync database IDs

-- Reset infofi_markets sequence to start from 1
CREATE OR REPLACE FUNCTION reset_infofi_markets_sequence()
RETURNS void AS $$
BEGIN
  -- Reset the sequence to 1
  PERFORM setval(pg_get_serial_sequence('infofi_markets', 'id'), 1, false);
END;
$$ LANGUAGE plpgsql;

-- Reset hybrid_pricing_cache doesn't need a sequence (uses market_id as PK)

-- Reset market_pricing_cache sequence if it exists
CREATE OR REPLACE FUNCTION reset_market_pricing_cache_sequence()
RETURNS void AS $$
BEGIN
  -- Only reset if the sequence exists
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'market_pricing_cache_market_id_seq') THEN
    PERFORM setval(pg_get_serial_sequence('market_pricing_cache', 'market_id'), 1, false);
  END IF;
END;
$$ LANGUAGE plpgsql;
