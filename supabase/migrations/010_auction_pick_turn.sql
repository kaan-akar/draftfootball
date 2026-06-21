-- Auction turn rules:
-- 1. If someone else wins the auction, the original picker keeps their turn (retry).
-- 2. Skip any player who already filled the current round's slot (e.g. won an auction).

create or replace function public.draft_picker_at_index(
  p_pick_order uuid[],
  p_round integer,
  p_index integer
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer;
  v_idx integer;
begin
  v_n := coalesce(array_length(p_pick_order, 1), 0);
  if v_n = 0 then
    return null;
  end if;

  v_idx := p_index % v_n;
  if (p_round - 1) % 2 = 0 then
    return p_pick_order[v_idx + 1];
  end if;
  return p_pick_order[v_n - v_idx];
end;
$$;

create or replace function public.user_has_round_pick(
  p_room_id uuid,
  p_user_id uuid,
  p_round integer,
  p_is_coach boolean
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_is_coach then exists (
      select 1
      from public.room_players rp
      where rp.room_id = p_room_id
        and rp.user_id = p_user_id
        and rp.picked_coach_id is not null
    )
    else exists (
      select 1
      from public.draft_picks dp
      where dp.room_id = p_room_id
        and dp.picker_id = p_user_id
        and dp.round = p_round
        and dp.football_player_id is not null
    )
  end;
$$;

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
  v_current_picker uuid;
  v_guard integer;
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

  v_next_round := v_session.current_round;
  v_next_phase := v_session.current_phase;
  v_room_status := null;

  -- Loser of an auction keeps the turn; everyone else advances.
  if p_pick_type = 'auction_won' and v_winner_id <> v_pending.picker_id then
    v_next_index := v_session.current_picker_index;
  else
    v_next_index := v_session.current_picker_index + 1;
  end if;

  -- Advance past players who already secured this round's slot (auction winners, etc.)
  v_guard := 0;
  while v_guard < v_player_count + 2 loop
    v_guard := v_guard + 1;

    if v_next_index >= v_player_count then
      v_next_index := 0;

      if v_is_coach then
        if not exists (
          select 1
          from public.room_players rp
          where rp.room_id = v_pending.room_id
            and rp.picked_coach_id is null
        ) then
          v_next_round := 1;
          v_next_phase := 'gk';
          v_room_status := 'player_draft';
          exit;
        end if;
      else
        if not exists (
          select 1
          from public.room_players rp
          where rp.room_id = v_pending.room_id
            and not public.user_has_round_pick(
              v_pending.room_id,
              rp.user_id,
              v_next_round,
              false
            )
        ) then
          v_next_round := v_session.current_round + 1;

          if v_next_round > 11 then
            v_next_phase := 'fwd';
            v_room_status := 'squad_review';
            exit;
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
    end if;

    v_current_picker := public.draft_picker_at_index(
      v_session.pick_order,
      v_next_round,
      v_next_index
    );

    if v_current_picker is null then
      exit;
    end if;

    if not public.user_has_round_pick(
      v_pending.room_id,
      v_current_picker,
      v_next_round,
      v_is_coach
    ) then
      exit;
    end if;

    v_next_index := v_next_index + 1;
  end loop;

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

grant execute on function public.draft_picker_at_index(uuid[], integer, integer) to authenticated;
grant execute on function public.user_has_round_pick(uuid, uuid, integer, boolean) to authenticated;
