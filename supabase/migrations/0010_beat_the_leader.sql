-- Beating a gym leader in any battle earns the badge. Gym challenges hand the gym over automatically;
-- a normal win offers the gym (winner decides, 15 minutes). Abandon checks use server time.
alter table public.battles add column if not exists gym_offer text references public.gyms (id) on delete set null;

create or replace function public.settle_battle(p_battle uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  v_loser uuid;
  v_gym public.gyms;
  r_w int;
  r_l int;
  expected numeric;
  delta int;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.status <> 'active' then return; end if;
  v_loser := case when p_winner = b.challenger_id then b.opponent_id else b.challenger_id end;

  select rating into r_w from public.players where id = p_winner;
  select rating into r_l from public.players where id = v_loser;
  expected := 1 / (1 + power(10, (r_l - r_w) / 400.0));
  delta := greatest(1, round(32 * (1 - expected)));

  update public.battles set status = 'finished', winner_id = p_winner, finished_at = now(), rating_delta = delta where id = p_battle;
  update public.players set wins = wins + 1, rating = rating + delta where id = p_winner;
  update public.players set losses = losses + 1, rating = greatest(100, rating - delta) where id = v_loser;

  if b.stake is not null then
    insert into public.debts (battle_id, debtor_id, creditor_id, stake) values (b.id, v_loser, p_winner, b.stake);
  end if;

  -- The gym at stake: the challenged gym, or whatever gym the loser happens to lead.
  if b.gym_id is not null then
    select * into v_gym from public.gyms where id = b.gym_id;
  else
    select * into v_gym from public.gyms where leader_id = v_loser;
  end if;

  if v_gym.id is not null and v_gym.leader_id = v_loser then
    insert into public.badges (player_id, gym_id, beaten_leader_id, battle_id)
    values (p_winner, v_gym.id, v_loser, b.id)
    on conflict (player_id, gym_id) do nothing;
    if b.gym_id is not null then
      if public.team_has_type(p_winner, v_gym.type) then
        update public.gyms set leader_id = null, claimed_at = null where leader_id = p_winner;
        update public.gyms set leader_id = p_winner, claimed_at = now() where id = v_gym.id;
      else
        update public.gyms set leader_id = null, claimed_at = null where id = v_gym.id;
      end if;
    else
      update public.battles set gym_offer = v_gym.id where id = p_battle;
    end if;
  elsif b.gym_id is not null then
    insert into public.gym_cooldowns (player_id, gym_id, until)
    values (b.challenger_id, b.gym_id, now() + interval '24 hours')
    on conflict (player_id, gym_id) do update set until = excluded.until;
  end if;
end $$;

create or replace function public.take_offered_gym(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  g public.gyms;
  v_loser uuid;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or b.winner_id <> auth.uid() then raise exception 'Niet jouw overwinning'; end if;
  if b.gym_offer is null then raise exception 'Er is geen gym te winnen bij dit gevecht'; end if;
  if b.finished_at < now() - interval '15 minutes' then raise exception 'Het aanbod is verlopen'; end if;
  v_loser := case when b.winner_id = b.challenger_id then b.opponent_id else b.challenger_id end;
  select * into g from public.gyms where id = b.gym_offer for update;
  if g.leader_id is not null and g.leader_id <> v_loser then raise exception 'Deze gym heeft intussen een andere leader'; end if;
  if not public.team_has_type(auth.uid(), g.type) then
    raise exception 'Je hebt geen %-type Pokémon in je team', g.type;
  end if;
  update public.gyms set leader_id = null, claimed_at = null where leader_id = auth.uid();
  update public.gyms set leader_id = auth.uid(), claimed_at = now() where id = g.id;
  update public.battles set gym_offer = null where id = p_battle;
end $$;
grant execute on function public.take_offered_gym(uuid) to authenticated;

-- Leaders always may accept; the type rule applies when claiming or taking over a gym.
create or replace function public.respond_battle(p_battle uuid, p_accept boolean) returns public.battles
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  g public.gyms;
  v_mine jsonb;
  v_theirs jsonb;
begin
  perform public.expire_stale_battles();
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or b.opponent_id <> auth.uid() then
    raise exception 'Geen uitnodiging voor jou';
  end if;
  if b.status <> 'pending' then
    return b;
  end if;
  if not p_accept then
    update public.battles set status = 'declined' where id = p_battle returning * into b;
    return b;
  end if;
  if b.gym_id is not null then
    select * into g from public.gyms where id = b.gym_id;
    if g.leader_id <> auth.uid() then raise exception 'Je bent geen leader meer van deze gym'; end if;
  end if;
  v_mine := public.team_snapshot(b.opponent_id);
  v_theirs := public.team_snapshot(b.challenger_id);
  if jsonb_array_length(v_mine -> 'pokemon') = 0 or jsonb_array_length(v_theirs -> 'pokemon') = 0 then
    raise exception 'Beide spelers hebben een team nodig';
  end if;
  update public.battles
    set status = 'active', challenger_team = v_theirs, opponent_team = v_mine
    where id = p_battle
    returning * into b;
  return b;
end $$;

-- Server-side view on whether the opponent left, so the UI never guesses with the client clock.
create or replace function public.abandon_check(p_battle uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  v_opponent uuid;
  v_seen_ago int;
  v_action_ago int;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  v_opponent := case when auth.uid() = b.challenger_id then b.opponent_id else b.challenger_id end;
  select extract(epoch from now() - last_seen_at)::int into v_seen_ago from public.players where id = v_opponent;
  select extract(epoch from now() - coalesce(max(created_at), b.created_at))::int into v_action_ago from public.battle_actions where battle_id = p_battle;
  return jsonb_build_object(
    'opponentSeenAgo', v_seen_ago,
    'lastActionAgo', v_action_ago,
    'claimable', v_seen_ago >= 120 and v_action_ago >= 120,
    'secondsLeft', greatest(0, 120 - least(v_seen_ago, v_action_ago))
  );
end $$;
grant execute on function public.abandon_check(uuid) to authenticated;
