-- Migration 014: Gating signatures for EIP-712 allowlist entries
CREATE TABLE IF NOT EXISTS gating_signatures (
    id SERIAL PRIMARY KEY,
    season_id INTEGER NOT NULL,
    participant_address TEXT NOT NULL,
    deadline BIGINT NOT NULL,
    signature TEXT NOT NULL,
    gate_index INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(season_id, participant_address, gate_index)
);

CREATE INDEX idx_gating_signatures_season ON gating_signatures(season_id);
CREATE INDEX idx_gating_signatures_lookup ON gating_signatures(season_id, participant_address);
