-- Nobody gets stuck: pending challenges expire, players can forfeit, and an abandoned battle can be claimed.
create or replace function public.expire_stale_battles() returns void
language sql security definer set search_path = public as $$
  update public.battles set status = 'cancelled'
  where status = 'pending' and created_at < now() - interval '3 minutes'
$$;

create or replace function public.tidy_battles() returns void
language sql security definer set search_path = public as $$
  select public.expire_stale_battles();
  select public.release_stale_gyms();
$$;
grant execute on function public.tidy_battles() to authenticated;

create or replace function public.settle_battle(p_battle uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  v_loser uuid;
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

  if b.gym_id is not null then
    if p_winner = b.challenger_id then
      insert into public.badges (player_id, gym_id, beaten_leader_id, battle_id)
      values (p_winner, b.gym_id, b.opponent_id, b.id)
      on conflict (player_id, gym_id) do nothing;
      update public.gyms set leader_id = null, claimed_at = null where leader_id = p_winner;
      update public.gyms set leader_id = p_winner, claimed_at = now() where id = b.gym_id;
    else
      insert into public.gym_cooldowns (player_id, gym_id, until)
      values (b.challenger_id, b.gym_id, now() + interval '24 hours')
      on conflict (player_id, gym_id) do update set until = excluded.until;
    end if;
  end if;
end $$;
revoke execute on function public.settle_battle(uuid, uuid) from public, anon, authenticated;

create or replace function public.finish_battle(p_battle uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  if p_winner not in (b.challenger_id, b.opponent_id) then
    raise exception 'Ongeldige winnaar';
  end if;
  perform public.settle_battle(p_battle, p_winner);
end $$;

create or replace function public.forfeit_battle(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  perform public.settle_battle(p_battle, case when auth.uid() = b.challenger_id then b.opponent_id else b.challenger_id end);
end $$;
grant execute on function public.forfeit_battle(uuid) to authenticated;

-- Opponent gone for 2 minutes (no heartbeat) and no action for 2 minutes: the remaining player may claim the win.
create or replace function public.claim_abandoned_battle(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  v_opponent uuid;
  v_last_seen timestamptz;
  v_last_action timestamptz;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  if b.status <> 'active' then return; end if;
  v_opponent := case when auth.uid() = b.challenger_id then b.opponent_id else b.challenger_id end;
  select last_seen_at into v_last_seen from public.players where id = v_opponent;
  select coalesce(max(created_at), b.created_at) into v_last_action from public.battle_actions where battle_id = p_battle;
  if v_last_seen > now() - interval '2 minutes' then
    raise exception 'Je tegenstander is nog online';
  end if;
  if v_last_action > now() - interval '2 minutes' then
    raise exception 'Nog even wachten, de laatste actie is korter dan 2 minuten geleden';
  end if;
  perform public.settle_battle(p_battle, auth.uid());
end $$;
grant execute on function public.claim_abandoned_battle(uuid) to authenticated;

-- Challenges also sweep expired ones first.
create or replace function public.challenge(p_opponent uuid, p_gym text default null, p_stake text default null) returns public.battles
language plpgsql security definer set search_path = public as $$
declare
  g public.gyms;
  b public.battles;
  v_stake text := nullif(trim(coalesce(p_stake, '')), '');
begin
  perform public.expire_stale_battles();
  if p_opponent = auth.uid() then raise exception 'Je kunt jezelf niet uitdagen'; end if;
  if not exists (select 1 from public.teams where player_id = auth.uid()) then raise exception 'Kies eerst een team'; end if;
  if exists (select 1 from public.battles where status in ('pending', 'active') and auth.uid() in (challenger_id, opponent_id)) then
    raise exception 'Je hebt al een openstaand gevecht';
  end if;
  if exists (select 1 from public.battles where status = 'active' and p_opponent in (challenger_id, opponent_id)) then
    raise exception 'Deze speler zit al in een gevecht';
  end if;
  if length(coalesce(v_stake, '')) > 140 then raise exception 'Inzet is te lang (max 140 tekens)'; end if;
  if p_gym is not null then
    perform public.release_stale_gyms();
    select * into g from public.gyms where id = p_gym;
    if g.id is null then raise exception 'Onbekende gym'; end if;
    if g.leader_id is null then raise exception 'Deze gym heeft geen leader'; end if;
    if g.leader_id <> p_opponent then raise exception 'Deze speler is geen leader van die gym'; end if;
    if exists (select 1 from public.gym_cooldowns c where c.player_id = auth.uid() and c.gym_id = p_gym and c.until > now()) then
      raise exception 'Je moet nog wachten voor je deze gym opnieuw mag uitdagen';
    end if;
  end if;
  insert into public.battles (challenger_id, opponent_id, gym_id, stake)
  values (auth.uid(), p_opponent, p_gym, v_stake) returning * into b;
  return b;
end $$;
