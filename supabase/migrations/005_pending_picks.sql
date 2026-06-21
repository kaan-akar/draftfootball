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

create or replace function public.finalize_draft_pick(
  p_pending_pick_id uuid,
  p_winner_id uuid default null,
  p_final_price integer default null,
  p_pick_type text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending public.pending_picks%rowtype;
  v_session public.draft_sessions%rowtype;
  v_player_count integer;
  v_is_coach boolean;
  v_winner_id uuid;
  v_price integer;
  v_next_index integer;
  v_next_round integer;
  v_next_phase text;
  v_room_status text;
begin
  select * into v_pending
  from public.pending_picks
  where id = p_pending_pick_id
  for update;

  if not found then
    raise exception 'Pending pick not found';
  end if;

  if v_pending.status = 'resolved' then
    return;
  end if;

  v_is_coach := v_pending.coach_id is not null;
  v_winner_id := coalesce(p_winner_id, v_pending.picker_id);
  v_price := coalesce(p_final_price, v_pending.final_price);

  insert into public.draft_picks (
    room_id,
    round,
    phase,
    picker_id,
    football_player_id,
    coach_id,
    pick_type,
    final_price
  ) values (
    v_pending.room_id,
    v_pending.round,
    v_pending.phase,
    v_winner_id,
    v_pending.football_player_id,
    v_pending.coach_id,
    p_pick_type,
    v_price
  );

  update public.room_players
  set
    coach_budget = case when v_is_coach then coach_budget - v_price else coach_budget end,
    player_budget = case when not v_is_coach then player_budget - v_price else player_budget end,
    picked_coach_id = case when v_is_coach then v_pending.coach_id else picked_coach_id end
  where room_id = v_pending.room_id
    and user_id = v_winner_id;

  update public.pending_picks
  set status = 'resolved', updated_at = now()
  where id = v_pending.id;

  update public.auctions
  set status = 'finished', updated_at = now()
  where pending_pick_id = v_pending.id
    and status = 'active';

  select * into v_session
  from public.draft_sessions
  where room_id = v_pending.room_id
  for update;

  if not found then
    raise exception 'Draft session not found';
  end if;

  select count(*) into v_player_count
  from public.room_players
  where room_id = v_pending.room_id;

  v_next_index := v_session.current_picker_index + 1;
  v_next_round := v_pending.round;
  v_next_phase := v_pending.phase;
  v_room_status := null;

  if v_is_coach then
    if v_next_index >= v_player_count then
      v_next_index := 0;
      v_next_round := 1;
      v_next_phase := 'gk';
      v_room_status := 'player_draft';
    end if;
  else
    if v_next_index >= v_player_count then
      v_next_index := 0;
      v_next_round := v_pending.round + 1;
      if v_next_round > 11 then
        v_next_phase := 'fwd';
        v_room_status := 'squad_review';
      elsif v_next_round = 1 then
        v_next_phase := 'gk';
      elsif v_next_round <= 5 then
        v_next_phase := 'def';
      elsif v_next_round <= 8 then
        v_next_phase := 'mid';
      else
        v_next_phase := 'fwd';
      end if;
    end if;
  end if;

  update public.draft_sessions
  set
    current_phase = v_next_phase,
    current_round = v_next_round,
    current_picker_index = v_next_index,
    updated_at = now()
  where room_id = v_pending.room_id;

  if v_room_status is not null then
    update public.game_rooms
    set status = v_room_status
    where id = v_pending.room_id;
  end if;
end;
$$;

grant execute on function public.finalize_draft_pick(uuid, uuid, integer, text) to authenticated;

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
