-- Migration: Raffle Transaction History System
-- Creates partitioned table, materialized view, and helper functions

-- ============================================================================
-- 1. CREATE PARTITIONED TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS raffle_transactions (
    id BIGSERIAL,
    season_id BIGINT NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    player_id BIGINT REFERENCES players(id),
    
    -- Transaction details
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('BUY', 'SELL', 'CLAIM', 'TRANSFER')),
    ticket_amount NUMERIC NOT NULL,
    sof_amount NUMERIC NOT NULL,
    price_per_ticket NUMERIC,
    
    -- Blockchain data
    tx_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    
    -- Position tracking
    tickets_before NUMERIC NOT NULL DEFAULT 0,
    tickets_after NUMERIC NOT NULL,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (id, season_id),
    UNIQUE (tx_hash, season_id)
) PARTITION BY RANGE (season_id);

-- Create indexes on parent table (inherited by all partitions)
CREATE INDEX IF NOT EXISTS idx_raffle_tx_user ON raffle_transactions(user_address, season_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_tx_hash ON raffle_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_raffle_tx_block ON raffle_transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_raffle_tx_player ON raffle_transactions(player_id, season_id);

-- ============================================================================
-- 2. AUTO-POPULATE PLAYER_ID TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION populate_raffle_tx_player_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.player_id IS NULL AND NEW.user_address IS NOT NULL THEN
        SELECT id INTO NEW.player_id
        FROM players
        WHERE address = NEW.user_address;
        
        -- If player doesn't exist, create them
        IF NEW.player_id IS NULL THEN
            INSERT INTO players (address, created_at, updated_at)
            VALUES (NEW.user_address, NOW(), NOW())
            ON CONFLICT (address) DO UPDATE SET updated_at = NOW()
            RETURNING id INTO NEW.player_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS raffle_tx_player_id_trigger ON raffle_transactions;
CREATE TRIGGER raffle_tx_player_id_trigger
    BEFORE INSERT ON raffle_transactions
    FOR EACH ROW
    EXECUTE FUNCTION populate_raffle_tx_player_id();

-- ============================================================================
-- 3. PARTITION MANAGEMENT FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION create_raffle_tx_partition(season_num BIGINT)
RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
BEGIN
    partition_name := 'raffle_transactions_season_' || season_num;
    
    -- Check if partition already exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF raffle_transactions 
             FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            season_num,
            season_num + 1
        );
        
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create partitions for existing seasons
DO $$
DECLARE
    season_record RECORD;
BEGIN
    FOR season_record IN 
        SELECT DISTINCT id FROM seasons ORDER BY id
    LOOP
        PERFORM create_raffle_tx_partition(season_record.id);
    END LOOP;
END $$;

-- Auto-create partition when new season is created
CREATE OR REPLACE FUNCTION auto_create_raffle_tx_partition()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_raffle_tx_partition(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS season_partition_trigger ON seasons;
CREATE TRIGGER season_partition_trigger
    AFTER INSERT ON seasons
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_raffle_tx_partition();

-- ============================================================================
-- 4. MATERIALIZED VIEW FOR FAST QUERIES
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS user_raffle_positions AS
SELECT 
    user_address,
    player_id,
    season_id,
    COUNT(*) as transaction_count,
    SUM(CASE WHEN transaction_type = 'BUY' THEN ticket_amount ELSE 0 END) as total_bought,
    SUM(CASE WHEN transaction_type = 'SELL' THEN ABS(ticket_amount) ELSE 0 END) as total_sold,
    SUM(ticket_amount) as current_tickets,
    SUM(sof_amount) as total_sof_spent,
    AVG(CASE WHEN transaction_type = 'BUY' THEN price_per_ticket ELSE NULL END) as avg_buy_price,
    MIN(block_timestamp) as first_transaction_at,
    MAX(block_timestamp) as last_transaction_at,
    ARRAY_AGG(tx_hash ORDER BY block_timestamp) as transaction_hashes
FROM raffle_transactions
GROUP BY user_address, player_id, season_id;

-- Indexes for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_raffle_pos_unique ON user_raffle_positions(user_address, season_id);
CREATE INDEX IF NOT EXISTS idx_user_raffle_pos_player ON user_raffle_positions(player_id, season_id);

-- ============================================================================
-- 5. REFRESH FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_user_positions(season_num BIGINT DEFAULT NULL)
RETURNS VOID AS $$
BEGIN
    -- For now, refresh entire view (can optimize later for specific seasons)
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_raffle_positions;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. ADD SYNC TRACKING TO SEASONS TABLE
-- ============================================================================

ALTER TABLE seasons 
ADD COLUMN IF NOT EXISTS last_tx_sync_block BIGINT DEFAULT 0;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify setup
DO $$
DECLARE
    partition_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO partition_count
    FROM pg_tables
    WHERE tablename LIKE 'raffle_transactions_season_%';
    
    RAISE NOTICE 'Migration complete! Created % season partitions', partition_count;
END $$;
