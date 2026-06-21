create table if not exists public.pending_picks (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references public.game_rooms(id) on delete cascade,
  picker_id           uuid not null references public.profiles(id),
  round               int not null,
  phase               text not null,
  football_player_id  uuid references public.football_players(id),
  coach_id            uuid references public.coaches(id),
  final_price         int not null,
  status              text not null default 'active'
                        check (status in ('active', 'auctioning', 'resolved')),
  eligible_objectors  uuid[] not null default '{}',
  passed_by           uuid[] not null default '{}',
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table public.pending_picks enable row level security;

drop policy if exists "Room members read" on public.pending_picks;
create policy "Room members read" on public.pending_picks for select
  using (exists (select 1 from public.room_players where room_id = pending_picks.room_id and user_id = auth.uid()));

drop policy if exists "Picker insert" on public.pending_picks;
create policy "Picker insert" on public.pending_picks for insert
  with check (auth.uid() = picker_id);

drop policy if exists "Room member update" on public.pending_picks;
create policy "Room member update" on public.pending_picks for update
  using (exists (select 1 from public.room_players where room_id = pending_picks.room_id and user_id = auth.uid()));

alter table public.auctions add column if not exists pending_pick_id uuid references public.pending_picks(id) on delete cascade;
alter table public.auctions add column if not exists passed_bidders uuid[] not null default '{}';

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pending_picks'
  ) then
    alter publication supabase_realtime add table public.pending_picks;
  end if;
end $$;
