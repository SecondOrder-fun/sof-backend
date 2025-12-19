-- Migration: 003_add_app_key_to_notification_tokens
-- Description: Add app_key column to track which client the token belongs to
-- This allows separate tokens per client (Base App vs Warpcast)

-- Add app_key column (nullable initially for existing rows)
ALTER TABLE farcaster_notification_tokens 
ADD COLUMN IF NOT EXISTS app_key TEXT;

-- Update existing rows to have a placeholder app_key based on notification_url
UPDATE farcaster_notification_tokens 
SET app_key = CASE 
    WHEN notification_url LIKE '%neynar%' THEN 'warpcast_legacy'
    WHEN notification_url LIKE '%farcaster.xyz%' THEN 'baseapp_legacy'
    ELSE 'unknown_legacy'
END
WHERE app_key IS NULL;

-- Make app_key NOT NULL after populating existing rows
ALTER TABLE farcaster_notification_tokens 
ALTER COLUMN app_key SET NOT NULL;

-- Create unique index on (fid, app_key) for upsert operations
CREATE UNIQUE INDEX IF NOT EXISTS idx_farcaster_notification_tokens_fid_app_key 
    ON farcaster_notification_tokens(fid, app_key);
