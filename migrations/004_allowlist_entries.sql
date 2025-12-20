-- Migration: 004_allowlist_entries
-- Description: Create tables for wallet-based allowlist system
-- Integrates with farcaster_notification_tokens to track users who added the app

-- Allowlist entries table - stores FID to wallet mappings
CREATE TABLE IF NOT EXISTS allowlist_entries (
    id BIGSERIAL PRIMARY KEY,
    fid BIGINT NOT NULL UNIQUE,                    -- User's Farcaster ID (unique per user)
    wallet_address VARCHAR(42),                     -- Primary wallet address (resolved from FID)
    username TEXT,                                  -- Farcaster username (for display)
    display_name TEXT,                              -- Farcaster display name
    source TEXT NOT NULL DEFAULT 'webhook',         -- How they were added: 'webhook', 'manual', 'import'
    is_active BOOLEAN DEFAULT true,                 -- Whether entry is currently active
    added_at TIMESTAMPTZ DEFAULT NOW(),             -- When they were added to allowlist
    wallet_resolved_at TIMESTAMPTZ,                 -- When wallet was resolved from FID
    metadata JSONB DEFAULT '{}',                    -- Additional data (pfp, etc)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allowlist configuration table - controls time-gated additions
CREATE TABLE IF NOT EXISTS allowlist_config (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'default',           -- Config name (for multiple windows)
    window_start TIMESTAMPTZ NOT NULL,              -- When allowlist additions open
    window_end TIMESTAMPTZ,                         -- When additions close (NULL = open indefinitely)
    is_active BOOLEAN DEFAULT true,                 -- Whether this config is active
    max_entries INTEGER,                            -- Optional cap on total entries
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for looking up by wallet address (for checking if user is allowlisted)
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_wallet 
    ON allowlist_entries(wallet_address) 
    WHERE wallet_address IS NOT NULL AND is_active = true;

-- Index for looking up by FID
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_fid 
    ON allowlist_entries(fid);

-- Index for active entries
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_active 
    ON allowlist_entries(is_active) 
    WHERE is_active = true;

-- Index for entries pending wallet resolution
CREATE INDEX IF NOT EXISTS idx_allowlist_entries_pending_resolution 
    ON allowlist_entries(wallet_resolved_at) 
    WHERE wallet_address IS NULL;

-- Index for active config
CREATE INDEX IF NOT EXISTS idx_allowlist_config_active 
    ON allowlist_config(is_active) 
    WHERE is_active = true;

-- Add comments for documentation
COMMENT ON TABLE allowlist_entries IS 'Stores allowlisted users with their FID and resolved wallet addresses';
COMMENT ON COLUMN allowlist_entries.fid IS 'User Farcaster ID - unique identifier';
COMMENT ON COLUMN allowlist_entries.wallet_address IS 'Primary Ethereum wallet address resolved from FID';
COMMENT ON COLUMN allowlist_entries.source IS 'How user was added: webhook (app add), manual (admin), import (bulk)';
COMMENT ON TABLE allowlist_config IS 'Configuration for time-gated allowlist windows';
COMMENT ON COLUMN allowlist_config.window_end IS 'NULL means open indefinitely';

-- Insert default config (open indefinitely starting now)
INSERT INTO allowlist_config (name, window_start, window_end, is_active)
VALUES ('default', NOW(), NULL, true)
ON CONFLICT DO NOTHING;
