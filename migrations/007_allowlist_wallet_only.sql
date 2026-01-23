-- Migration: 007_allowlist_wallet_only
-- Description: Support wallet-only allowlist entries by making fid nullable and enforcing proper uniqueness

-- 1) Normalize existing wallet addresses (defensive)
UPDATE allowlist_entries
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address IS NOT NULL;

-- 2) Make fid nullable (wallet-only identities)
ALTER TABLE allowlist_entries
ALTER COLUMN fid DROP NOT NULL;

-- 3) Drop the old UNIQUE constraint on fid (name may vary across environments)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'allowlist_entries'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(fid)%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE allowlist_entries DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- 4) Enforce uniqueness for fid (when present) and wallet_address (when present)
CREATE UNIQUE INDEX IF NOT EXISTS uq_allowlist_entries_fid_not_null
  ON allowlist_entries (fid)
  WHERE fid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_allowlist_entries_wallet_not_null
  ON allowlist_entries (LOWER(wallet_address))
  WHERE wallet_address IS NOT NULL;
