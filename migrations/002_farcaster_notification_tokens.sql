-- Migration: 002_farcaster_notification_tokens
-- Description: Create table to store Farcaster/Base App notification tokens
-- Token uniqueness is enforced by the token itself (unique per client/app/user tuple)

CREATE TABLE IF NOT EXISTS farcaster_notification_tokens (
    id BIGSERIAL PRIMARY KEY,
    fid BIGINT NOT NULL,                          -- User's Farcaster ID
    notification_url TEXT NOT NULL,               -- URL to POST notifications to
    notification_token TEXT NOT NULL UNIQUE,      -- Token is unique globally
    notifications_enabled BOOLEAN DEFAULT true,   -- Whether notifications are currently enabled
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for looking up all tokens for a user
CREATE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_fid 
    ON farcaster_notification_tokens(fid);

-- Index for finding users with notifications enabled (for bulk sends)
CREATE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_enabled 
    ON farcaster_notification_tokens(notifications_enabled) 
    WHERE notifications_enabled = true;

-- Add comment for documentation
COMMENT ON TABLE farcaster_notification_tokens IS 'Stores notification tokens for Farcaster Mini App users';
COMMENT ON COLUMN farcaster_notification_tokens.fid IS 'User Farcaster ID';
COMMENT ON COLUMN farcaster_notification_tokens.notification_url IS 'URL to POST notifications to';
COMMENT ON COLUMN farcaster_notification_tokens.notification_token IS 'Unique token per (client, app, user) tuple - uniqueness enforced by token itself';
