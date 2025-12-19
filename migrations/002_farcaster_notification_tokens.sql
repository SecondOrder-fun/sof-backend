-- Migration: 002_farcaster_notification_tokens
-- Description: Create table to store Farcaster/Base App notification tokens
-- Each user can have multiple tokens (one per client app they use)

CREATE TABLE IF NOT EXISTS farcaster_notification_tokens (
    id BIGSERIAL PRIMARY KEY,
    fid BIGINT NOT NULL,                          -- User's Farcaster ID
    app_fid BIGINT NOT NULL,                      -- Client app FID (309857=Base, 9152=Warpcast, etc.)
    notification_url TEXT NOT NULL,               -- URL to POST notifications to
    notification_token TEXT NOT NULL,             -- Secret token for this (fid, app_fid) tuple
    notifications_enabled BOOLEAN DEFAULT true,   -- Whether notifications are currently enabled
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint: one token per (fid, app_fid) pair
    -- A user can have tokens from multiple clients
    UNIQUE(fid, app_fid)
);

-- Index for looking up all tokens for a user
CREATE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_fid 
    ON farcaster_notification_tokens(fid);

-- Index for finding users with notifications enabled (for bulk sends)
CREATE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_enabled 
    ON farcaster_notification_tokens(notifications_enabled) 
    WHERE notifications_enabled = true;

-- Add comment for documentation
COMMENT ON TABLE farcaster_notification_tokens IS 'Stores notification tokens for Farcaster Mini App users. Each user can have multiple tokens (one per client app).';
COMMENT ON COLUMN farcaster_notification_tokens.fid IS 'User Farcaster ID';
COMMENT ON COLUMN farcaster_notification_tokens.app_fid IS 'Client app FID (309857=Base App, 9152=Warpcast)';
COMMENT ON COLUMN farcaster_notification_tokens.notification_url IS 'URL to POST notifications to';
COMMENT ON COLUMN farcaster_notification_tokens.notification_token IS 'Secret token unique to (fid, app_fid) tuple';
