-- Recreate InfoFi Positions table (accidentally deleted)
-- This migration recreates the infofi_positions table with all indexes and RLS policies

create table if not exists infofi_positions (
  id bigserial primary key,
  market_id bigint not null references infofi_markets(id) on delete cascade,
  user_address varchar(42) not null,
  outcome varchar(10) not null, -- 'YES' | 'NO'
  amount numeric(38, 18) not null,
  price numeric(38, 18),
  created_at timestamptz default now()
);

-- Create indexes for performance
create index if not exists idx_infofi_positions_market on infofi_positions (market_id);
create index if not exists idx_infofi_positions_user on infofi_positions (user_address);

-- Enable Row Level Security
alter table infofi_positions enable row level security;

-- Create read-only policy (allow all to read)
create policy if not exists infofi_positions_read on infofi_positions for select using (true);
