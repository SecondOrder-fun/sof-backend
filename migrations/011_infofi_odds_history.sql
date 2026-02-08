-- Historical odds snapshots for InfoFi prediction markets.
-- Replaces the previous Redis sorted-set storage with a Supabase table.

create table if not exists infofi_odds_history (
  id bigserial primary key,
  market_id bigint not null references infofi_markets(id) on delete cascade,
  season_id bigint not null,
  recorded_at timestamptz not null default now(),
  yes_bps integer not null,
  no_bps integer not null,
  hybrid_bps integer not null default 0,
  raffle_bps integer not null default 0,
  sentiment_bps integer not null default 0
);

-- Primary query pattern: fetch odds for a market within a time range, ordered by time
create index if not exists idx_odds_history_market_time
  on infofi_odds_history (market_id, recorded_at);

-- Secondary: filter by season
create index if not exists idx_odds_history_season
  on infofi_odds_history (season_id);

-- RLS: read-only for all, writes via service role key
alter table infofi_odds_history enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where policyname = 'infofi_odds_history_read'
  ) then
    create policy infofi_odds_history_read
      on infofi_odds_history for select using (true);
  end if;
end $$;
