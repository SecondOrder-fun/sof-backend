-- Migration: 005_nft_drops
-- Description: Create table for NFT drops (mints and airdrops via Mint.Club)

-- NFT drops table - stores configured NFT mints and airdrops
CREATE TABLE IF NOT EXISTS nft_drops (
    id BIGSERIAL PRIMARY KEY,
    
    -- Drop identification
    name TEXT NOT NULL,                               -- Display name for the drop
    description TEXT,                                 -- Description of the drop
    
    -- Mint.Club configuration
    network TEXT NOT NULL DEFAULT 'base',             -- Network: base, ethereum, optimism, etc.
    drop_type TEXT NOT NULL,                          -- 'mint' (bonding curve) or 'airdrop' (free claim)
    
    -- For 'mint' type drops (bonding curve NFTs)
    nft_symbol TEXT,                                  -- NFT symbol on Mint.Club (e.g., 'SOFPASS')
    nft_contract_address TEXT,                        -- NFT contract address (optional, for reference)
    
    -- For 'airdrop' type drops (MerkleDistributor claims)
    airdrop_id INTEGER,                               -- Mint.Club airdrop/distribution ID
    
    -- Access control
    requires_allowlist BOOLEAN DEFAULT true,          -- Whether drop requires allowlist
    
    -- Timing
    start_time TIMESTAMPTZ,                           -- When drop becomes available (NULL = immediate)
    end_time TIMESTAMPTZ,                             -- When drop ends (NULL = no end)
    
    -- Status
    is_active BOOLEAN DEFAULT true,                   -- Whether drop is currently active
    is_featured BOOLEAN DEFAULT false,                -- Whether to feature prominently in UI
    
    -- Metadata
    image_url TEXT,                                   -- Image URL for display
    external_url TEXT,                                -- Link to mint.club page or other
    metadata JSONB DEFAULT '{}',                      -- Additional metadata
    
    -- Audit
    created_by TEXT,                                  -- Admin who created the drop
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active drops
CREATE INDEX IF NOT EXISTS idx_nft_drops_active 
    ON nft_drops(is_active, is_featured) 
    WHERE is_active = true;

-- Index for drop type
CREATE INDEX IF NOT EXISTS idx_nft_drops_type 
    ON nft_drops(drop_type);

-- Index for network
CREATE INDEX IF NOT EXISTS idx_nft_drops_network 
    ON nft_drops(network);

-- Index for timing (find currently available drops)
CREATE INDEX IF NOT EXISTS idx_nft_drops_timing 
    ON nft_drops(start_time, end_time) 
    WHERE is_active = true;

-- Add comments for documentation
COMMENT ON TABLE nft_drops IS 'Stores NFT drop configurations for Mint.Club mints and airdrops';
COMMENT ON COLUMN nft_drops.drop_type IS 'Type of drop: mint (user pays via bonding curve) or airdrop (free claim)';
COMMENT ON COLUMN nft_drops.nft_symbol IS 'For mint drops: the NFT symbol on Mint.Club';
COMMENT ON COLUMN nft_drops.airdrop_id IS 'For airdrop drops: the Mint.Club distribution ID';
COMMENT ON COLUMN nft_drops.requires_allowlist IS 'If true, only allowlisted users can access this drop';
