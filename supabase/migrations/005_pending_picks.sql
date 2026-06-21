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

create or replace function public.compatible_positions_for_slot(p_slot text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_slot
    when 'GK' then array['GK']::text[]
    when 'RB' then array['RB', 'CB']::text[]
    when 'CB' then array['CB', 'RB', 'LB', 'CDM']::text[]
    when 'LB' then array['LB', 'CB']::text[]
    when 'CDM' then array['CDM', 'CM', 'CB']::text[]
    when 'CM' then array['CM', 'CDM', 'CAM', 'RM', 'LM']::text[]
    when 'CAM' then array['CAM', 'CM', 'RW', 'LW']::text[]
    when 'RM' then array['RM', 'CM', 'RW']::text[]
    when 'LM' then array['LM', 'CM', 'LW']::text[]
    when 'RW' then array['RW', 'RM', 'CAM', 'ST']::text[]
    when 'LW' then array['LW', 'LM', 'CAM', 'ST']::text[]
    when 'CF' then array['CF', 'ST', 'CAM']::text[]
    when 'ST' then array['ST', 'CF', 'RW', 'LW']::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.formation_slots_for_random_assign(p_formation text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_formation
    when '4-4-2' then array['GK','RB','CB','CB','LB','RM','CM','CM','LM','ST','ST']::text[]
    when '4-3-3' then array['GK','RB','CB','CB','LB','CM','CM','CM','RW','ST','LW']::text[]
    when '4-2-3-1' then array['GK','RB','CB','CB','LB','CDM','CDM','CAM','RW','LW','ST']::text[]
    when '3-5-2' then array['GK','CB','CB','CB','RM','CM','CDM','CM','LM','ST','ST']::text[]
    when '5-3-2' then array['GK','RB','CB','CB','CB','LB','CM','CM','CM','ST','ST']::text[]
    when '4-5-1' then array['GK','RB','CB','CB','LB','RM','CM','CDM','CM','LM','ST']::text[]
    when '3-4-3' then array['GK','CB','CB','CB','RM','CM','CM','LM','RW','ST','LW']::text[]
    when '4-1-4-1' then array['GK','RB','CB','CB','LB','CDM','RM','CM','CM','LM','ST']::text[]
    else array[]::text[]
  end;
$$;

create or replace function public.quick_start_random_tournament(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_player_count integer;
  v_used_players uuid[] := array[]::uuid[];
  v_used_coaches uuid[] := array[]::uuid[];
  v_player record;
  v_coach record;
  v_football_player record;
  v_slots text[];
  v_slot text;
  v_round integer;
  v_home uuid;
  v_away uuid;
  v_user_ids uuid[];
begin
  select * into v_room
  from public.game_rooms
  where id = p_room_id;

  if not found then
    raise exception 'Oda bulunamadı';
  end if;

  if auth.uid() is null or auth.uid() <> v_room.host_id then
    raise exception 'Sadece host hızlı testi başlatabilir';
  end if;

  select count(*) into v_player_count
  from public.room_players
  where room_id = p_room_id;

  if v_player_count < 2 then
    raise exception 'En az 2 oyuncu gerekli';
  end if;

  if exists (
    select 1
    from public.room_players
    where room_id = p_room_id
      and formation is null
  ) then
    raise exception 'Herkes formasyon seçmeli';
  end if;

  delete from public.auctions where room_id = p_room_id;
  delete from public.pending_picks where room_id = p_room_id;
  delete from public.matches where room_id = p_room_id;
  delete from public.standings where room_id = p_room_id;
  delete from public.draft_picks where room_id = p_room_id;
  delete from public.draft_sessions where room_id = p_room_id;

  update public.room_players
  set player_budget = 100,
      coach_budget = 20,
      objection_rights = 3,
      picked_coach_id = null,
      is_ready = true
  where room_id = p_room_id;

  for v_player in
    select *
    from public.room_players
    where room_id = p_room_id
    order by joined_at, user_id
  loop
    select * into v_coach
    from public.coaches
    where not (id = any(v_used_coaches))
    order by random()
    limit 1;

    if not found then
      raise exception 'Yeterli teknik direktör bulunamadı';
    end if;

    v_used_coaches := array_append(v_used_coaches, v_coach.id);

    insert into public.draft_picks (
      room_id, round, phase, picker_id, coach_id, pick_type, final_price
    ) values (
      p_room_id, 1, 'coach', v_player.user_id, v_coach.id, 'normal', v_coach.price
    );

    update public.room_players
    set picked_coach_id = v_coach.id,
        coach_budget = greatest(0, coach_budget - v_coach.price)
    where room_id = p_room_id and user_id = v_player.user_id;

    v_slots := public.formation_slots_for_random_assign(v_player.formation);
    if coalesce(array_length(v_slots, 1), 0) <> 11 then
      raise exception 'Geçersiz formasyon: %', v_player.formation;
    end if;

    for v_round in 1..11 loop
      v_slot := v_slots[v_round];

      select * into v_football_player
      from public.football_players
      where not (id = any(v_used_players))
        and positions && public.compatible_positions_for_slot(v_slot)
      order by random()
      limit 1;

      if not found then
        raise exception 'Yeterli uyumlu oyuncu bulunamadı';
      end if;

      v_used_players := array_append(v_used_players, v_football_player.id);

      insert into public.draft_picks (
        room_id, round, phase, picker_id, football_player_id, pick_type, final_price
      ) values (
        p_room_id,
        v_round,
        case
          when v_round = 1 then 'gk'
          when v_round <= 5 then 'def'
          when v_round <= 8 then 'mid'
          else 'fwd'
        end,
        v_player.user_id,
        v_football_player.id,
        'normal',
        v_football_player.price
      );

      update public.room_players
      set player_budget = greatest(0, player_budget - v_football_player.price)
      where room_id = p_room_id and user_id = v_player.user_id;
    end loop;
  end loop;

  select array_agg(user_id order by joined_at, user_id)
    into v_user_ids
  from public.room_players
  where room_id = p_room_id;

  v_round := 1;
  for i in 1..coalesce(array_length(v_user_ids, 1), 0) loop
    for j in (i + 1)..coalesce(array_length(v_user_ids, 1), 0) loop
      v_home := v_user_ids[i];
      v_away := v_user_ids[j];
      continue when v_home is null or v_away is null;

      insert into public.matches (
        room_id, home_player_id, away_player_id, round, status, home_score, away_score, events, summary, mvp
      ) values (
        p_room_id, v_home, v_away, v_round, 'scheduled', 0, 0, '[]'::jsonb, '', ''
      );

      v_round := v_round + 1;
    end loop;
  end loop;

  insert into public.standings (
    room_id, user_id, played, won, drawn, lost, goals_for, goals_against, points
  )
  select p_room_id, user_id, 0, 0, 0, 0, 0, 0, 0
  from public.room_players
  where room_id = p_room_id;

  update public.game_rooms
  set status = 'tournament'
  where id = p_room_id;
end;
$$;

grant execute on function public.compatible_positions_for_slot(text) to authenticated;
grant execute on function public.formation_slots_for_random_assign(text) to authenticated;
grant execute on function public.quick_start_random_tournament(uuid) to authenticated;

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
