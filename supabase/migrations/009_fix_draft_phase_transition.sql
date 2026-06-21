-- Fix draft phase/round advancement: derive round from draft_sessions (not stale
-- pending_picks metadata) and always sync current_phase from current_round.

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

  select * into v_session
  from public.draft_sessions
  where room_id = v_pending.room_id
  for update;

  if not found then
    raise exception 'Draft session not found';
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
    v_session.current_round,
    v_session.current_phase,
    v_winner_id,
    v_pending.football_player_id,
    v_pending.coach_id,
    p_pick_type,
    v_price
  );

  update public.room_players
  set
    player_budget = player_budget - v_price,
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

  select count(*) into v_player_count
  from public.room_players
  where room_id = v_pending.room_id;

  v_next_index := v_session.current_picker_index + 1;
  v_next_round := v_session.current_round;
  v_next_phase := v_session.current_phase;
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
      v_next_round := v_session.current_round + 1;
    end if;

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

-- Repair rooms already stuck on round 1/gk after all GK picks were recorded.
update public.draft_sessions ds
set
  current_round = 2,
  current_phase = 'def',
  current_picker_index = 0,
  updated_at = now()
where ds.current_round = 1
  and ds.current_phase = 'gk'
  and exists (
    select 1
    from public.draft_picks dp
    where dp.room_id = ds.room_id
      and dp.phase = 'gk'
      and dp.round = 1
    group by dp.room_id
    having count(*) >= (
      select count(*) from public.room_players rp where rp.room_id = ds.room_id
    )
  )
  and not exists (
    select 1
    from public.pending_picks pp
    where pp.room_id = ds.room_id
      and pp.status in ('active', 'auctioning')
  );
