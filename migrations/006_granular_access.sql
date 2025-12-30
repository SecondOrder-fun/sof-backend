-- ============================================================
-- PART 1: Access Levels on Allowlist Entries
-- ============================================================

-- Add access_level column to allowlist_entries
ALTER TABLE allowlist_entries 
ADD COLUMN IF NOT EXISTS access_level INTEGER DEFAULT 2;

COMMENT ON COLUMN allowlist_entries.access_level IS 
  'Access tier: 0=public, 1=connected, 2=allowlist, 3=beta, 4=admin';

CREATE INDEX IF NOT EXISTS idx_allowlist_entries_access_level 
  ON allowlist_entries(access_level) 
  WHERE is_active = true;

-- ============================================================
-- PART 2: Access Groups (for granular resource-level control)
-- ============================================================

-- Groups table - defines available access groups
CREATE TABLE IF NOT EXISTS access_groups (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,              -- e.g., 'season-5-vip'
    name TEXT NOT NULL,                      -- e.g., 'Season #5 VIP Access'
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE access_groups IS 'Defines access groups for granular resource-level permissions';

-- User-Group membership (many-to-many)
CREATE TABLE IF NOT EXISTS user_access_groups (
    id BIGSERIAL PRIMARY KEY,
    fid BIGINT NOT NULL,                     -- References allowlist_entries.fid
    group_id INTEGER NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    granted_by TEXT,                         -- Admin FID or 'system'
    expires_at TIMESTAMPTZ,                  -- Optional expiration
    is_active BOOLEAN DEFAULT true,
    UNIQUE(fid, group_id)
);

CREATE INDEX IF NOT EXISTS idx_user_access_groups_fid 
  ON user_access_groups(fid) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_access_groups_group 
  ON user_access_groups(group_id) WHERE is_active = true;

COMMENT ON TABLE user_access_groups IS 'Links users to access groups';

-- ============================================================
-- PART 3: Route/Resource Access Configuration
-- ============================================================

-- Route access configuration - defines requirements per route/resource
CREATE TABLE IF NOT EXISTS route_access_config (
    id SERIAL PRIMARY KEY,
    route_pattern TEXT NOT NULL,             -- e.g., '/raffles', '/raffles/:id', '/raffles/5'
    resource_type TEXT,                      -- e.g., 'page', 'raffle', 'market'
    resource_id TEXT,                        -- e.g., '5' for specific raffle
    
    -- Access requirements
    required_level INTEGER DEFAULT 2,        -- Minimum access level (0-4)
    required_groups TEXT[],                  -- Array of group slugs (user needs ANY of these)
    require_all_groups BOOLEAN DEFAULT false,-- If true, user needs ALL groups
    
    -- Override flags
    is_public BOOLEAN DEFAULT false,         -- Override: make fully public
    is_disabled BOOLEAN DEFAULT false,       -- Override: block everyone (maintenance)
    
    -- Metadata
    name TEXT,                               -- Display name
    description TEXT,
    priority INTEGER DEFAULT 0,              -- Higher = checked first (for pattern matching)
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_access_config_pattern 
  ON route_access_config(route_pattern);
CREATE INDEX IF NOT EXISTS idx_route_access_config_resource 
  ON route_access_config(resource_type, resource_id);

COMMENT ON TABLE route_access_config IS 'Defines access requirements per route or resource';

-- ============================================================
-- PART 4: System Settings
-- ============================================================

-- System settings table for global config
CREATE TABLE IF NOT EXISTS access_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

-- Insert default settings
INSERT INTO access_settings (key, value) VALUES
  ('default_access_level', '2'),              -- New entries get level 2 (allowlist)
  ('global_public_override', 'false')         -- Emergency: make everything public
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE access_settings IS 'Global access control settings';

-- ============================================================
-- PART 5: Default Route Configurations
-- ============================================================

-- Insert default route configurations
INSERT INTO route_access_config (route_pattern, resource_type, required_level, name) VALUES
  ('/', 'page', 0, 'Home'),
  ('/raffles', 'page', 2, 'Raffles List'),
  ('/raffles/:id', 'page', 2, 'Raffle Detail'),
  ('/markets', 'page', 3, 'InfoFi Markets'),
  ('/account', 'page', 1, 'Account'),
  ('/admin', 'page', 4, 'Admin Panel')
ON CONFLICT DO NOTHING;
