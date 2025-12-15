-- InfoFi schema aligned with instructions/data-schema.md (2025-08-17)
-- Creates markets, positions, winnings, pricing cache, and arbitrage tables.

-- InfoFi Markets
create table if not exists infofi_markets (
  id bigserial primary key,
  season_id bigint not null,
  player_address varchar(42),
  market_type varchar(50) not null, -- 'WINNER_PREDICTION' | 'POSITION_SIZE' | 'BEHAVIORAL'
  contract_address varchar(42),
  initial_probability_bps integer not null,
  current_probability_bps integer not null,
  is_active boolean default true,
  is_settled boolean default false,
  settlement_time timestamptz,
  winning_outcome boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Unique to avoid duplicate auto-creation for a (season, type, player)
create unique index if not exists ux_infofi_markets_season_type_player
  on infofi_markets (season_id, market_type, player_address);

create index if not exists idx_infofi_markets_season on infofi_markets (season_id);
create index if not exists idx_infofi_markets_active on infofi_markets (is_active) where is_active = true;

-- InfoFi Positions (user bets)
create table if not exists infofi_positions (
  id bigserial primary key,
  market_id bigint not null references infofi_markets(id) on delete cascade,
  user_address varchar(42) not null,
  outcome varchar(10) not null, -- 'YES' | 'NO'
  amount numeric(38, 18) not null,
  price numeric(38, 18),
  created_at timestamptz default now()
);

create index if not exists idx_infofi_positions_market on infofi_positions (market_id);
create index if not exists idx_infofi_positions_user on infofi_positions (user_address);

-- InfoFi Winnings (claimable)
create table if not exists infofi_winnings (
  id bigserial primary key,
  user_address varchar(42) not null,
  market_id bigint not null references infofi_markets(id) on delete cascade,
  amount numeric(38, 18) not null,
  is_claimed boolean default false,
  claimed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_infofi_winnings_user_open on infofi_winnings (user_address) where is_claimed = false;

-- Market Pricing Cache (bps-based)
create table if not exists market_pricing_cache (
  market_id bigint primary key references infofi_markets(id) on delete cascade,
  raffle_probability_bps integer not null,
  market_sentiment_bps integer not null,
  hybrid_price_bps integer not null,
  raffle_weight_bps integer default 7000,
  market_weight_bps integer default 3000,
  last_updated timestamptz default now()
);

-- Arbitrage Opportunities (analytics)
create table if not exists arbitrage_opportunities (
  id bigserial primary key,
  raffle_id bigint not null,
  player_address varchar(42) not null,
  market_id bigint references infofi_markets(id) on delete set null,
  raffle_price_bps integer not null,
  market_price_bps integer not null,
  price_difference_bps integer not null,
  profitability_pct numeric(10, 4) not null,
  estimated_profit numeric(38, 18) not null,
  is_executed boolean default false,
  executed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_arbitrage_raf on arbitrage_opportunities (raffle_id);
create index if not exists idx_arbitrage_open on arbitrage_opportunities (is_executed) where is_executed = false;

-- Optional basic RLS (enable and allow read-all; adjust per auth later)
alter table infofi_markets enable row level security;
alter table infofi_positions enable row level security;
alter table market_pricing_cache enable row level security;

-- Read-only policies (adjust as needed)
create policy if not exists infofi_markets_read on infofi_markets for select using (true);
create policy if not exists infofi_positions_read on infofi_positions for select using (true);
create policy if not exists market_pricing_cache_read on market_pricing_cache for select using (true);
