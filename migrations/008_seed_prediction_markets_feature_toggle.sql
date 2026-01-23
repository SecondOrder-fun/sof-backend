-- Migration: 008_seed_prediction_markets_feature_toggle
-- Description: Seed a route_access_config entry used as a feature toggle for prediction markets

-- Ensure we can upsert by route_pattern
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_access_config_route_pattern
  ON route_access_config (route_pattern);

INSERT INTO route_access_config (
  route_pattern,
  resource_type,
  resource_id,
  required_level,
  required_groups,
  require_all_groups,
  is_public,
  is_disabled,
  name,
  description,
  priority,
  created_at,
  updated_at
)
VALUES (
  '__feature__/prediction_markets',
  'feature',
  'prediction_markets',
  2,
  ARRAY[]::text[],
  false,
  false,
  false,
  'Prediction Markets Feature',
  'Feature toggle for Prediction Markets UI and routes',
  100,
  NOW(),
  NOW()
)
ON CONFLICT (route_pattern)
DO UPDATE SET
  resource_type = EXCLUDED.resource_type,
  resource_id = EXCLUDED.resource_id,
  required_level = EXCLUDED.required_level,
  required_groups = EXCLUDED.required_groups,
  require_all_groups = EXCLUDED.require_all_groups,
  is_public = EXCLUDED.is_public,
  -- Do not overwrite is_disabled; keep current toggle state
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  priority = EXCLUDED.priority,
  updated_at = NOW();
