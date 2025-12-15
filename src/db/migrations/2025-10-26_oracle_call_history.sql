-- Migration: Create oracle_call_history table for audit trail
-- Date: Oct 26, 2025
-- Purpose: Track all oracle calls for monitoring, debugging, and audit purposes

CREATE TABLE IF NOT EXISTS oracle_call_history (
  id BIGSERIAL PRIMARY KEY,
  
  -- Market identification
  fpmm_address VARCHAR(42) NOT NULL,
  season_id BIGINT,
  player_address VARCHAR(42),
  
  -- Call details
  function_name VARCHAR(50) NOT NULL, -- 'updateRaffleProbability' or 'updateMarketSentiment'
  parameters JSONB NOT NULL, -- {fpmmAddress, raffleProbabilityBps} or {fpmmAddress, marketSentimentBps}
  
  -- Execution tracking
  status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'pending', 'retrying'
  attempt_count INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  
  -- Result details
  transaction_hash VARCHAR(66), -- Ethereum transaction hash if successful
  error_message TEXT, -- Error message if failed
  error_code VARCHAR(50), -- Error code for categorization
  
  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ, -- When the call finally succeeded or was abandoned
  
  -- Metadata
  request_id VARCHAR(100), -- Unique request ID for correlation
  retry_reason TEXT, -- Why it was retried
  notes TEXT -- Additional notes for debugging
);

-- Indexes for fast lookups
CREATE INDEX idx_oracle_call_history_fpmm_address 
  ON oracle_call_history(fpmm_address);

CREATE INDEX idx_oracle_call_history_status 
  ON oracle_call_history(status);

CREATE INDEX idx_oracle_call_history_created_at 
  ON oracle_call_history(created_at DESC);

CREATE INDEX idx_oracle_call_history_player 
  ON oracle_call_history(player_address);

CREATE INDEX idx_oracle_call_history_season 
  ON oracle_call_history(season_id);

CREATE INDEX idx_oracle_call_history_function 
  ON oracle_call_history(function_name);

-- Index for finding failed calls that need retry
CREATE INDEX idx_oracle_call_history_failed 
  ON oracle_call_history(status, last_attempt_at DESC) 
  WHERE status IN ('failed', 'retrying');

-- Index for audit trail queries
CREATE INDEX idx_oracle_call_history_audit 
  ON oracle_call_history(fpmm_address, created_at DESC);

-- Enable Row Level Security
ALTER TABLE oracle_call_history ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all reads (for monitoring/audit)
CREATE POLICY "oracle_call_history_read" 
  ON oracle_call_history FOR SELECT 
  USING (true);

-- Policy: Allow inserts only from backend
CREATE POLICY "oracle_call_history_insert" 
  ON oracle_call_history FOR INSERT 
  WITH CHECK (true);

-- Policy: Allow updates only for status/retry tracking
CREATE POLICY "oracle_call_history_update" 
  ON oracle_call_history FOR UPDATE 
  USING (true) 
  WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE oracle_call_history IS 
  'Audit trail for all oracle calls. Used for monitoring, debugging, and retry logic.';

COMMENT ON COLUMN oracle_call_history.fpmm_address IS 
  'SimpleFPMM contract address (market ID)';

COMMENT ON COLUMN oracle_call_history.function_name IS 
  'Oracle function called: updateRaffleProbability or updateMarketSentiment';

COMMENT ON COLUMN oracle_call_history.parameters IS 
  'JSON parameters passed to oracle function';

COMMENT ON COLUMN oracle_call_history.status IS 
  'Call status: success, failed, pending, retrying';

COMMENT ON COLUMN oracle_call_history.transaction_hash IS 
  'Ethereum transaction hash if call succeeded';

COMMENT ON COLUMN oracle_call_history.error_message IS 
  'Error message if call failed';

COMMENT ON COLUMN oracle_call_history.request_id IS 
  'Unique request ID for correlation across logs';
