-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── Profiles ──────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  avatar_emoji text not null default '⚽',
  created_at  timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Public read" on public.profiles for select using (true);
create policy "Own insert" on public.profiles for insert with check (auth.uid() = id);
create policy "Own update" on public.profiles for update using (auth.uid() = id);

-- ─── Football Players (static lookup) ──────────────────────────────────────
create table public.football_players (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  position_group  text not null check (position_group in ('GK','DEF','MID','FWD')),
  positions       text[] not null,
  price           int not null check (price between 1 and 10),
  peak_years      text not null,
  caps            int not null default 0,
  goals           int not null default 0,
  bio             text not null default ''
);
alter table public.football_players enable row level security;
create policy "Public read" on public.football_players for select using (true);

-- ─── Coaches (static lookup) ────────────────────────────────────────────────
create table public.coaches (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  preferred_formations text[] not null,
  price                int not null check (price between 1 and 10),
  style                text not null,
  bio                  text not null default ''
);
alter table public.coaches enable row level security;
create policy "Public read" on public.coaches for select using (true);

-- ─── Game Rooms ─────────────────────────────────────────────────────────────
create table public.game_rooms (
  id                  uuid primary key default gen_random_uuid(),
  host_id             uuid not null references public.profiles(id),
  join_code           text not null unique,
  status              text not null default 'lobby'
                        check (status in ('lobby','coach_draft','player_draft','squad_review','tournament','finished')),
  max_players         int not null default 20,
  coach_draft_budget  int not null default 20,
  created_at          timestamptz default now()
);
alter table public.game_rooms enable row level security;
create policy "Public read" on public.game_rooms for select using (true);
create policy "Auth insert" on public.game_rooms for insert with check (auth.uid() = host_id);
create policy "Host update" on public.game_rooms for update using (auth.uid() = host_id);

-- ─── Room Players ───────────────────────────────────────────────────────────
create table public.room_players (
  room_id          uuid not null references public.game_rooms(id) on delete cascade,
  user_id          uuid not null references public.profiles(id),
  username         text not null,
  formation        text,
  player_budget    int not null default 100,
  coach_budget     int not null default 20,
  objection_rights int not null default 3,
  picked_coach_id  uuid references public.coaches(id),
  is_ready         boolean not null default false,
  joined_at        timestamptz default now(),
  primary key (room_id, user_id)
);
alter table public.room_players enable row level security;
create policy "Room members read" on public.room_players for select using (true);
create policy "Auth insert" on public.room_players for insert with check (auth.uid() = user_id);
create policy "Own update" on public.room_players for update using (auth.uid() = user_id);

-- ─── Draft Sessions ──────────────────────────────────────────────────────────
create table public.draft_sessions (
  room_id               uuid primary key references public.game_rooms(id) on delete cascade,
  current_phase         text not null default 'coach'
                          check (current_phase in ('coach','gk','def','mid','fwd')),
  current_round         int not null default 1,
  pick_order            uuid[] not null default '{}',
  current_picker_index  int not null default 0,
  updated_at            timestamptz default now()
);
alter table public.draft_sessions enable row level security;
create policy "Public read" on public.draft_sessions for select using (true);
create policy "Host manage" on public.draft_sessions for all
  using (exists (select 1 from public.game_rooms where id = room_id and host_id = auth.uid()));

-- ─── Draft Picks ────────────────────────────────────────────────────────────
create table public.draft_picks (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.game_rooms(id) on delete cascade,
  round               int not null,
  phase               text not null,
  picker_id           uuid not null references public.profiles(id),
  football_player_id  uuid references public.football_players(id),
  coach_id            uuid references public.coaches(id),
  pick_type           text not null default 'normal' check (pick_type in ('normal','auction_won')),
  final_price         int not null,
  picked_at           timestamptz default now()
);
alter table public.draft_picks enable row level security;
create policy "Public read" on public.draft_picks for select using (true);
create policy "Auth insert" on public.draft_picks for insert with check (auth.uid() = picker_id);

-- ─── Auctions ───────────────────────────────────────────────────────────────
create table public.auctions (
  id                      uuid primary key default gen_random_uuid(),
  room_id                 uuid not null references public.game_rooms(id) on delete cascade,
  target_player_id        uuid references public.football_players(id),
  target_coach_id         uuid references public.coaches(id),
  initiated_by            uuid not null references public.profiles(id),
  status                  text not null default 'active' check (status in ('active','finished')),
  base_price              int not null,
  current_highest_bid     int not null,
  current_highest_bidder  uuid references public.profiles(id),
  current_bidder_index    int not null default 0,
  eligible_bidders        uuid[] not null default '{}',
  bids                    jsonb not null default '[]',
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);
alter table public.auctions enable row level security;
create policy "Public read" on public.auctions for select using (true);
create policy "Auth insert" on public.auctions for insert with check (auth.uid() = initiated_by);
create policy "Room member update" on public.auctions for update
  using (exists (select 1 from public.room_players where room_id = auctions.room_id and user_id = auth.uid()));

-- ─── Matches ────────────────────────────────────────────────────────────────
create table public.matches (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.game_rooms(id) on delete cascade,
  home_player_id  uuid not null references public.profiles(id),
  away_player_id  uuid not null references public.profiles(id),
  round           int not null,
  status          text not null default 'scheduled' check (status in ('scheduled','live','finished')),
  home_score      int not null default 0,
  away_score      int not null default 0,
  events          jsonb not null default '[]',
  summary         text not null default '',
  mvp             text not null default '',
  played_at       timestamptz
);
alter table public.matches enable row level security;
create policy "Public read" on public.matches for select using (true);
create policy "Host manage" on public.matches for all
  using (exists (select 1 from public.game_rooms where id = room_id and host_id = auth.uid()));

-- ─── Standings ──────────────────────────────────────────────────────────────
create table public.standings (
  room_id        uuid not null references public.game_rooms(id) on delete cascade,
  user_id        uuid not null references public.profiles(id),
  played         int not null default 0,
  won            int not null default 0,
  drawn          int not null default 0,
  lost           int not null default 0,
  goals_for      int not null default 0,
  goals_against  int not null default 0,
  points         int not null default 0,
  primary key (room_id, user_id)
);
alter table public.standings enable row level security;
create policy "Public read" on public.standings for select using (true);
create policy "Host manage" on public.standings for all
  using (exists (select 1 from public.game_rooms where id = room_id and host_id = auth.uid()));

-- ─── Realtime ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.game_rooms;
alter publication supabase_realtime add table public.room_players;
alter publication supabase_realtime add table public.draft_sessions;
alter publication supabase_realtime add table public.draft_picks;
alter publication supabase_realtime add table public.auctions;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.standings;
