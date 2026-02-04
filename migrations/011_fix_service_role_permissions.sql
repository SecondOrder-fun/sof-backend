-- Migration: Fix service_role permissions for INSERT operations
-- Problem: service_role key gets "42501 permission denied for schema public" on INSERT
-- (SELECT and UPDATE work fine, but INSERT fails)
--
-- Run this in the Supabase Dashboard SQL Editor with admin/postgres privileges.
-- This grants the necessary schema and table permissions to the service_role.

-- 1. Ensure service_role has USAGE on the public schema
GRANT USAGE ON SCHEMA public TO service_role;

-- 2. Grant CREATE on public schema (needed for INSERT operations via PostgREST)
GRANT CREATE ON SCHEMA public TO service_role;

-- 3. Grant ALL privileges on ALL existing tables in public schema
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

-- 4. Grant ALL privileges on ALL sequences (needed for auto-increment PKs on INSERT)
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 5. Set default privileges so future tables/sequences also get these grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

-- 6. Also grant to the authenticated and anon roles for completeness
-- (these are controlled by RLS policies, so granting table access is safe)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- 7. Verify: list grants on key tables
-- Run these SELECT statements after the GRANTs to confirm:
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND table_name IN ('season_contracts', 'infofi_markets', 'players', 'infofi_failed_markets')
--     AND grantee = 'service_role';

-- 8. Create listener_block_cursors table for persistent block tracking
-- This stores the last processed block per listener so restarts don't miss events.
CREATE TABLE IF NOT EXISTS listener_block_cursors (
  listener_key TEXT PRIMARY KEY,        -- e.g. "0xABC123:SeasonStarted"
  last_block   BIGINT NOT NULL,         -- last fully processed block number
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grant permissions on the new table
GRANT ALL PRIVILEGES ON listener_block_cursors TO service_role;

COMMENT ON TABLE listener_block_cursors IS 'Persists last processed block per event listener for crash recovery';
