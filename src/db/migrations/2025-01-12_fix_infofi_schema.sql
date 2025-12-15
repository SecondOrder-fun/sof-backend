-- Fix InfoFi schema to ensure data integrity and support player tracking
-- Date: 2025-01-12
-- Purpose: Make player_address NOT NULL, add players table for future features

-- Create players table for centralized player metadata
create table if not exists players (
  id bigserial primary key,
  address varchar(42) not null unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_players_address on players (address);

-- Enable RLS for players table
alter table players enable row level security;

-- Read-only policy for players
create policy if not exists players_read on players for select using (true);

-- Make player_address NOT NULL in infofi_markets (it should always be set)
-- First, update any NULL values (shouldn't exist, but safety first)
update infofi_markets set player_address = '0x0000000000000000000000000000000000000000' where player_address is null;

-- Now make it NOT NULL
alter table infofi_markets alter column player_address set not null;

-- Add comment for clarity on season_id vs raffle_id terminology
comment on column infofi_markets.season_id is 'References the raffle season ID (equivalent to raffle_id in other contexts)';

-- Add player_id column for optional normalization (can be populated later)
alter table infofi_markets add column if not exists player_id bigint references players(id) on delete set null;

-- Add index on player_id for faster lookups when using normalized approach
create index if not exists idx_infofi_markets_player_id on infofi_markets (player_id);

-- Note: We're using player_address as the primary identifier for now
-- player_id can be populated asynchronously for future features like usernames
