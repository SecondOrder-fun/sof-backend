-- Migration: 012_user_access_groups_wallet_support
-- Description: Support wallet-only users in access groups by making fid nullable and adding wallet_address

-- 1) Make fid nullable on user_access_groups
ALTER TABLE user_access_groups
ALTER COLUMN fid DROP NOT NULL;

-- 2) Add wallet_address column
ALTER TABLE user_access_groups
ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(42);

-- 3) Drop old UNIQUE(fid, group_id) constraint
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'user_access_groups'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%(fid, group_id)%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE user_access_groups DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- 4) Add partial unique indexes for fid and wallet_address
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_groups_fid_group
  ON user_access_groups (fid, group_id)
  WHERE fid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_access_groups_wallet_group
  ON user_access_groups (wallet_address, group_id)
  WHERE wallet_address IS NOT NULL;

-- 5) Add CHECK constraint: at least one identifier must be present
ALTER TABLE user_access_groups
ADD CONSTRAINT chk_user_access_groups_identifier
  CHECK (fid IS NOT NULL OR wallet_address IS NOT NULL);

-- 6) Add index on wallet_address for lookups
CREATE INDEX IF NOT EXISTS idx_user_access_groups_wallet
  ON user_access_groups(wallet_address)
  WHERE wallet_address IS NOT NULL AND is_active = true;
