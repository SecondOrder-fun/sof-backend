-- Migration: 010_make_raffles_portfolio_public
-- Description: Make Raffles and Portfolio routes publicly accessible (no allowlist required)

-- Ensure uniqueness for upsert
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_access_config_route_pattern
  ON route_access_config (route_pattern);

-- Raffles list and detail routes
INSERT INTO route_access_config (
  route_pattern,
  resource_type,
  required_level,
  required_groups,
  require_all_groups,
  is_public,
  is_disabled,
  name,
  priority,
  created_at,
  updated_at
)
VALUES
  ('/raffles', 'page', 0, ARRAY[]::text[], false, false, false, 'Raffles List (Public)', 50, NOW(), NOW()),
  ('/raffles/:id', 'page', 0, ARRAY[]::text[], false, false, false, 'Raffle Detail (Public)', 50, NOW(), NOW())
ON CONFLICT (route_pattern)
DO UPDATE SET
  required_level = 0,
  required_groups = ARRAY[]::text[],
  require_all_groups = false,
  is_public = false,
  -- do not overwrite is_disabled
  name = EXCLUDED.name,
  priority = EXCLUDED.priority,
  updated_at = NOW();

-- Portfolio route
INSERT INTO route_access_config (
  route_pattern,
  resource_type,
  required_level,
  required_groups,
  require_all_groups,
  is_public,
  is_disabled,
  name,
  priority,
  created_at,
  updated_at
)
VALUES
  ('/portfolio', 'page', 0, ARRAY[]::text[], false, false, false, 'Portfolio (Public)', 50, NOW(), NOW())
ON CONFLICT (route_pattern)
DO UPDATE SET
  required_level = 0,
  required_groups = ARRAY[]::text[],
  require_all_groups = false,
  is_public = false,
  -- do not overwrite is_disabled
  name = EXCLUDED.name,
  priority = EXCLUDED.priority,
  updated_at = NOW();
