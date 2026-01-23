-- Migration: 009_lockdown_admin_allowlist
-- Description: Restrict ADMIN access to only specific FIDs and wallet address

-- Canonical admin identifiers
-- FIDs: 13837, 1047382
-- Wallet: 0x1ed4ac856d7a072c3a336c0971a47db86a808ff4

-- Normalize wallet addresses defensively
UPDATE allowlist_entries
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address IS NOT NULL;

-- 1) Demote all existing admins except the allowed set
UPDATE allowlist_entries
SET access_level = 2,
    updated_at = NOW()
WHERE access_level = 4
  AND COALESCE(fid, -1) NOT IN (13837, 1047382)
  AND LOWER(COALESCE(wallet_address, '')) <> '0x1ed4ac856d7a072c3a336c0971a47db86a808ff4';

-- 2) Ensure the allowed FIDs are present and elevated to ADMIN
UPDATE allowlist_entries
SET is_active = true,
    access_level = 4,
    updated_at = NOW()
WHERE fid IN (13837, 1047382);

INSERT INTO allowlist_entries (
  fid,
  wallet_address,
  source,
  is_active,
  added_at,
  access_level,
  created_at,
  updated_at
)
SELECT
  v.fid,
  NULL,
  'manual',
  true,
  NOW(),
  4,
  NOW(),
  NOW()
FROM (
  VALUES (13837), (1047382)
) AS v(fid)
WHERE NOT EXISTS (
  SELECT 1
  FROM allowlist_entries a
  WHERE a.fid = v.fid
);

-- 3) Ensure the allowed wallet is present and elevated to ADMIN (wallet-only identity)
UPDATE allowlist_entries
SET is_active = true,
    access_level = 4,
    updated_at = NOW()
WHERE LOWER(wallet_address) = '0x1ed4ac856d7a072c3a336c0971a47db86a808ff4';

INSERT INTO allowlist_entries (
  fid,
  wallet_address,
  source,
  is_active,
  added_at,
  wallet_resolved_at,
  access_level,
  created_at,
  updated_at
)
SELECT
  NULL,
  '0x1ed4ac856d7a072c3a336c0971a47db86a808ff4',
  'manual',
  true,
  NOW(),
  NOW(),
  4,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM allowlist_entries
  WHERE LOWER(wallet_address) = '0x1ed4ac856d7a072c3a336c0971a47db86a808ff4'
);
