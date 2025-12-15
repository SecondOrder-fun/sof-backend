-- Migration: Event Processing State Table
-- Purpose: Track last processed block for historical event scanning
-- Created: 2025-01-24

CREATE TABLE IF NOT EXISTS event_processing_state (
    event_type VARCHAR(50) PRIMARY KEY,
    last_block BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial state for position updates
INSERT INTO event_processing_state (event_type, last_block)
VALUES ('position_updates', 0)
ON CONFLICT (event_type) DO NOTHING;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_event_processing_state_event_type 
ON event_processing_state(event_type);

-- Add comment
COMMENT ON TABLE event_processing_state IS 'Tracks last processed block number for event listeners to enable historical scanning on restart';
