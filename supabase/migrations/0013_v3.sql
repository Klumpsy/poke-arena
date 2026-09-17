-- v3: history & spectating, abilities, two-party finish, Discord notifications, tournaments, champion, quests, titles.

-- Abilities from PokeTokenBar (new format) travel with the Pokémon.
alter table public.pokemon add column if not exists ability text;

create or replace function public.upsert_pokemon(
  p_player uuid, p_id uuid, p_species int, p_profile jsonb, p_shiny boolean, p_active boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ivs jsonb := p_profile -> 'ivs';
begin
  insert into public.pokemon (id, player_id, species_id, level, nature, ivs, moves, shiny, gender, is_active, ability, updated_at)
  values (
    p_id,
    p_player,
    p_species,
    greatest(1, least(100, coalesce((p_profile ->> 'level')::int, 1))),
    lower(coalesce(p_profile ->> 'nature', 'hardy')),
    jsonb_build_object(
      'hp', coalesce((v_ivs ->> 'hp')::int, 0),
      'atk', coalesce((v_ivs ->> 'attack')::int, 0),
      'def', coalesce((v_ivs ->> 'defense')::int, 0),
      'spa', coalesce((v_ivs ->> 'specialAttack')::int, 0),
      'spd', coalesce((v_ivs ->> 'specialDefense')::int, 0),
      'spe', coalesce((v_ivs ->> 'speed')::int, 0)
    ),
    coalesce((select jsonb_agg(m ->> 'name') from jsonb_array_elements(coalesce(p_profile -> 'moves', '[]'::jsonb)) m), '[]'::jsonb),
    p_shiny,
    coalesce(p_profile ->> 'gender', 'genderless'),
    p_active,
    nullif(p_profile ->> 'abilityName', ''),
    now()
  )
  on conflict (id) do update set
    player_id = excluded.player_id,
    species_id = excluded.species_id,
    level = excluded.level,
    nature = excluded.nature,
    ivs = excluded.ivs,
    moves = excluded.moves,
    shiny = excluded.shiny,
    gender = excluded.gender,
    is_active = excluded.is_active,
    ability = excluded.ability,
    updated_at = now();
end $$;

create or replace function public.team_snapshot(p_player uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pokemon', coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'speciesId', p.species_id,
      'level', p.level,
      'nature', p.nature,
      'ivs', p.ivs,
      'moves', coalesce(p.custom_moves, p.moves),
      'shiny', p.shiny,
      'gender', p.gender,
      'ability', p.ability
    ) order by ord
  ), '[]'::jsonb))
  from public.teams t
  cross join unnest(t.pokemon_ids) with ordinality as u(pokemon_id, ord)
  join public.pokemon p on p.id = u.pokemon_id and p.player_id = t.player_id
  where t.player_id = p_player
$$;

-- History and spectating: everyone signed in may read battles and their action log.
drop policy if exists "battles visible to participants" on public.battles;
create policy "battles readable" on public.battles for select to authenticated using (true);
drop policy if exists "actions visible to participants" on public.battle_actions;
create policy "actions readable" on public.battle_actions for select to authenticated using (true);

-- Two-party finish: a loser's word settles at once; a self-declared winner needs the opponent's confirmation.
alter table public.battles drop constraint if exists battles_status_check;
alter table public.battles add constraint battles_status_check
  check (status in ('pending', 'active', 'finished', 'declined', 'cancelled', 'disputed'));

create table if not exists public.finish_votes (
  battle_id uuid not null references public.battles (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  winner_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (battle_id, player_id)
);
alter table public.finish_votes enable row level security;
create policy "votes readable" on public.finish_votes for select to authenticated using (true);

create or replace function public.finish_battle(p_battle uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  v_other uuid;
  v_other_vote uuid;
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  if b.status <> 'active' then return; end if;
  if p_winner not in (b.challenger_id, b.opponent_id) then
    raise exception 'Ongeldige winnaar';
  end if;
  insert into public.finish_votes (battle_id, player_id, winner_id) values (p_battle, auth.uid(), p_winner)
  on conflict (battle_id, player_id) do update set winner_id = excluded.winner_id;

  if p_winner <> auth.uid() then
    perform public.settle_battle(p_battle, p_winner);
    return;
  end if;
  v_other := case when auth.uid() = b.challenger_id then b.opponent_id else b.challenger_id end;
  select winner_id into v_other_vote from public.finish_votes where battle_id = p_battle and player_id = v_other;
  if v_other_vote is null then return; end if;
  if v_other_vote = p_winner then
    perform public.settle_battle(p_battle, p_winner);
  else
    update public.battles set status = 'disputed', finished_at = now() where id = p_battle;
  end if;
end $$;

create or replace function public.claim_abandoned_battle(p_battle uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  v_opponent uuid;
  v_last_seen timestamptz;
  v_last_action timestamptz;
  v_other_vote uuid;
begin
  select * into b from public.battles where id = p_battle;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  if b.status <> 'active' then return; end if;
  v_opponent := case when auth.uid() = b.challenger_id then b.opponent_id else b.challenger_id end;
  select winner_id into v_other_vote from public.finish_votes where battle_id = p_battle and player_id = v_opponent;
  if v_other_vote is not null then
    perform public.settle_battle(p_battle, v_other_vote);
    return;
  end if;
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

-- Champion and titles.
create table if not exists public.champion (
  id int primary key default 1 check (id = 1),
  player_id uuid references public.players (id) on delete set null,
  since timestamptz
);
alter table public.champion enable row level security;
create policy "champion readable" on public.champion for select to authenticated using (true);
insert into public.champion (id) values (1) on conflict do nothing;

create table if not exists public.titles (
  player_id uuid not null references public.players (id) on delete cascade,
  code text not null,
  label text not null,
  earned_at timestamptz not null default now(),
  primary key (player_id, code)
);
alter table public.titles enable row level security;
create policy "titles readable" on public.titles for select to authenticated using (true);

alter table public.battles add column if not exists champion_match boolean not null default false;
alter table public.battles add column if not exists tournament_match_id uuid;

create or replace function public.badge_count(p_player uuid) returns int
language sql stable as $$ select count(*)::int from public.badges where player_id = p_player $$;

create or replace function public.champion_defender() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select player_id from public.champion where id = 1),
    (select id from public.players where exists (select 1 from public.teams t where t.player_id = players.id) order by rating desc, wins desc limit 1)
  )
$$;
grant execute on function public.champion_defender() to authenticated;

-- Tournaments.
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'open' check (status in ('open', 'running', 'finished', 'cancelled')),
  created_by uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  winner_id uuid references public.players (id) on delete set null
);
create table if not exists public.tournament_players (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  seed int,
  primary key (tournament_id, player_id)
);
create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  round int not null,
  position int not null,
  p1 uuid references public.players (id) on delete set null,
  p2 uuid references public.players (id) on delete set null,
  winner_id uuid references public.players (id) on delete set null,
  battle_id uuid references public.battles (id) on delete set null,
  unique (tournament_id, round, position)
);
alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.tournament_matches enable row level security;
create policy "tournaments readable" on public.tournaments for select to authenticated using (true);
create policy "tournament players readable" on public.tournament_players for select to authenticated using (true);
create policy "tournament matches readable" on public.tournament_matches for select to authenticated using (true);
alter table public.battles add constraint battles_tournament_match_fk foreign key (tournament_match_id) references public.tournament_matches (id) on delete set null;

create or replace function public.create_tournament(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'Geef het toernooi een naam (min. 3 tekens)'; end if;
  if exists (select 1 from public.tournaments where status in ('open', 'running')) then
    raise exception 'Er loopt al een toernooi';
  end if;
  insert into public.tournaments (name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into public.tournament_players (tournament_id, player_id) values (v_id, auth.uid());
  return v_id;
end $$;
grant execute on function public.create_tournament(text) to authenticated;

create or replace function public.join_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tournaments where id = p_tournament and status = 'open') then raise exception 'Inschrijving is gesloten'; end if;
  if not exists (select 1 from public.teams where player_id = auth.uid()) then raise exception 'Kies eerst een team'; end if;
  insert into public.tournament_players (tournament_id, player_id) values (p_tournament, auth.uid()) on conflict do nothing;
end $$;
grant execute on function public.join_tournament(uuid) to authenticated;

create or replace function public.leave_tournament(p_tournament uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.tournament_players where tournament_id = p_tournament and player_id = auth.uid()
    and exists (select 1 from public.tournaments where id = p_tournament and status = 'open');
$$;
grant execute on function public.leave_tournament(uuid) to authenticated;

create or replace function public.cancel_tournament(p_tournament uuid) returns void
language sql security definer set search_path = public as $$
  update public.tournaments set status = 'cancelled', finished_at = now()
  where id = p_tournament and created_by = auth.uid() and status in ('open', 'running');
$$;
grant execute on function public.cancel_tournament(uuid) to authenticated;

create or replace function public.start_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  v_players uuid[];
  v_n int;
  v_size int := 1;
  v_i int;
  v_p1 uuid;
  v_p2 uuid;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  if t.id is null or t.status <> 'open' then raise exception 'Toernooi kan niet starten'; end if;
  if t.created_by <> auth.uid() then raise exception 'Alleen de organisator kan starten'; end if;
  select array_agg(tp.player_id order by p.rating desc, p.wins desc, p.created_at) into v_players
  from public.tournament_players tp join public.players p on p.id = tp.player_id where tp.tournament_id = p_tournament;
  v_n := coalesce(array_length(v_players, 1), 0);
  if v_n < 2 then raise exception 'Minstens 2 deelnemers nodig'; end if;
  while v_size < v_n loop v_size := v_size * 2; end loop;
  -- Seeded pairs: 1 vs n, 2 vs n-1, ... byes for the top seeds when the bracket is not full.
  for v_i in 1..(v_size / 2) loop
    v_p1 := v_players[v_i];
    v_p2 := case when v_size - v_i + 1 <= v_n then v_players[v_size - v_i + 1] else null end;
    insert into public.tournament_matches (tournament_id, round, position, p1, p2, winner_id)
    values (p_tournament, 1, v_i, v_p1, v_p2, case when v_p2 is null then v_p1 else null end);
  end loop;
  update public.tournaments set status = 'running', started_at = now() where id = p_tournament;
  perform public.advance_tournament(p_tournament);
end $$;
grant execute on function public.start_tournament(uuid) to authenticated;

-- Create next-round matches once a round has enough winners; finish when the final is decided.
create or replace function public.advance_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round int;
  v_count int;
  v_unresolved int;
  m record;
  v_pos int;
  v_winner uuid;
begin
  select max(round) into v_round from public.tournament_matches where tournament_id = p_tournament;
  if v_round is null then return; end if;
  select count(*), count(*) filter (where winner_id is null) into v_count, v_unresolved
  from public.tournament_matches where tournament_id = p_tournament and round = v_round;
  if v_unresolved > 0 then return; end if;
  if v_count = 1 then
    select winner_id into v_winner from public.tournament_matches where tournament_id = p_tournament and round = v_round;
    update public.tournaments set status = 'finished', finished_at = now(), winner_id = v_winner where id = p_tournament;
    insert into public.titles (player_id, code, label)
    select v_winner, 'tournament-' || p_tournament::text, 'Winnaar ' || name from public.tournaments where id = p_tournament
    on conflict do nothing;
    return;
  end if;
  v_pos := 0;
  for m in
    select a.winner_id as w1, b.winner_id as w2
    from public.tournament_matches a
    join public.tournament_matches b on b.tournament_id = a.tournament_id and b.round = a.round and b.position = a.position + 1
    where a.tournament_id = p_tournament and a.round = v_round and a.position % 2 = 1
    order by a.position
  loop
    v_pos := v_pos + 1;
    insert into public.tournament_matches (tournament_id, round, position, p1, p2, winner_id)
    values (p_tournament, v_round + 1, v_pos, m.w1, m.w2, case when m.w2 is null then m.w1 when m.w1 is null then m.w2 else null end)
    on conflict (tournament_id, round, position) do nothing;
  end loop;
  perform public.advance_tournament(p_tournament);
end $$;

-- Challenge: now also tournament matches and champion challenges.
drop function if exists public.challenge(uuid, text, text);
create or replace function public.challenge(p_opponent uuid, p_gym text default null, p_stake text default null, p_tournament_match uuid default null, p_champion boolean default false) returns public.battles
language plpgsql security definer set search_path = public as $$
declare
  g public.gyms;
  b public.battles;
  m public.tournament_matches;
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
  if p_tournament_match is not null then
    select * into m from public.tournament_matches where id = p_tournament_match;
    if m.id is null or m.winner_id is not null then raise exception 'Deze toernooiwedstrijd is al beslist'; end if;
    if not (auth.uid() in (m.p1, m.p2) and p_opponent in (m.p1, m.p2)) then raise exception 'Jullie spelen niet tegen elkaar in deze ronde'; end if;
    if exists (select 1 from public.battles where tournament_match_id = p_tournament_match and status in ('pending', 'active')) then
      raise exception 'Er staat al een uitdaging voor deze wedstrijd';
    end if;
  end if;
  if p_champion then
    if public.badge_count(auth.uid()) < (select count(*) from public.gyms) then
      raise exception 'Je hebt alle % badges nodig om de Champion uit te dagen', (select count(*) from public.gyms);
    end if;
    if public.champion_defender() <> p_opponent then raise exception 'Deze speler is niet de Champion'; end if;
  end if;
  insert into public.battles (challenger_id, opponent_id, gym_id, stake, tournament_match_id, champion_match)
  values (auth.uid(), p_opponent, p_gym, v_stake, p_tournament_match, p_champion) returning * into b;
  return b;
end $$;
grant execute on function public.challenge(uuid, text, text, uuid, boolean) to authenticated;

-- Settle: plus tournament advancement, champion title, quest/title bookkeeping and Discord.
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
  v_streak int;
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

  if b.tournament_match_id is not null then
    update public.tournament_matches set winner_id = p_winner, battle_id = b.id where id = b.tournament_match_id and winner_id is null;
    perform public.advance_tournament((select tournament_id from public.tournament_matches where id = b.tournament_match_id));
  end if;

  if b.champion_match and p_winner = b.challenger_id then
    delete from public.titles where code = 'champion';
    update public.champion set player_id = p_winner, since = now() where id = 1;
    insert into public.titles (player_id, code, label) values (p_winner, 'champion', 'Champion') on conflict do nothing;
  end if;

  -- Streak titles.
  select count(*) into v_streak from (
    select winner_id = p_winner as won from public.battles
    where status = 'finished' and p_winner in (challenger_id, opponent_id)
    order by finished_at desc limit 10
  ) s where won and not exists (
    select 1 from (
      select winner_id = p_winner as won, finished_at from public.battles
      where status = 'finished' and p_winner in (challenger_id, opponent_id)
      order by finished_at desc limit 10
    ) t where not t.won and t.finished_at > (select min(finished_at) from (
      select finished_at, winner_id = p_winner as won from public.battles
      where status = 'finished' and p_winner in (challenger_id, opponent_id) order by finished_at desc limit 10) u where u.won)
  );
  if v_streak >= 3 then insert into public.titles (player_id, code, label) values (p_winner, 'streak-3', 'Hattrick') on conflict do nothing; end if;
  if v_streak >= 5 then insert into public.titles (player_id, code, label) values (p_winner, 'streak-5', 'Onverslaanbaar') on conflict do nothing; end if;
  if delta >= 24 then insert into public.titles (player_id, code, label) values (p_winner, 'giant-slayer', 'Giant slayer') on conflict do nothing; end if;
  if b.gym_id is not null and p_winner = b.opponent_id then
    if (select count(*) from public.battles where gym_id is not null and opponent_id = p_winner and winner_id = p_winner and status = 'finished') >= 5 then
      insert into public.titles (player_id, code, label) values (p_winner, 'gym-defender', 'Gym-verdediger') on conflict do nothing;
    end if;
  end if;
  if public.badge_count(p_winner) >= (select count(*) from public.gyms) then
    insert into public.titles (player_id, code, label) values (p_winner, 'all-badges', 'Alle badges') on conflict do nothing;
  end if;
end $$;

-- Current win streak, for display.
create or replace function public.current_streak(p_player uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from (
    select won, sum(case when won then 0 else 1 end) over (order by finished_at desc) as losses_before
    from (
      select winner_id = p_player as won, finished_at from public.battles
      where status = 'finished' and p_player in (challenger_id, opponent_id)
    ) x
  ) y where won and losses_before = 0
$$;
grant execute on function public.current_streak(uuid) to authenticated;

-- Weekly quests, computed live over this ISO week.
create or replace function public.weekly_quests(p_player uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with wk as (
    select date_trunc('week', now()) as start
  ), won as (
    select b.* from public.battles b, wk where b.status = 'finished' and b.winner_id = p_player and b.finished_at >= wk.start
  ), played as (
    select b.* from public.battles b, wk where b.status = 'finished' and p_player in (b.challenger_id, b.opponent_id) and b.finished_at >= wk.start
  )
  select jsonb_build_array(
    jsonb_build_object('code', 'wins3', 'title', 'Win 3 gevechten', 'progress', least(3, (select count(*) from won)), 'target', 3, 'points', 10),
    jsonb_build_object('code', 'opponents3', 'title', 'Versla 3 verschillende collega''s', 'progress', least(3, (select count(distinct case when challenger_id = p_player then opponent_id else challenger_id end) from won)), 'target', 3, 'points', 15),
    jsonb_build_object('code', 'underdog', 'title', 'Win met een Pokémon onder level 30 in je team', 'progress', least(1, (select count(*) from won w where exists (
        select 1 from jsonb_array_elements(case when w.challenger_id = p_player then w.challenger_team else w.opponent_team end -> 'pokemon') p where (p ->> 'level')::int < 30))), 'target', 1, 'points', 15),
    jsonb_build_object('code', 'gymwin', 'title', 'Win een gym-uitdaging', 'progress', least(1, (select count(*) from won where gym_id is not null and challenger_id = p_player)), 'target', 1, 'points', 20),
    jsonb_build_object('code', 'played5', 'title', 'Speel 5 gevechten', 'progress', least(5, (select count(*) from played)), 'target', 5, 'points', 10),
    jsonb_build_object('code', 'stake', 'title', 'Vecht om een inzet', 'progress', least(1, (select count(*) from played where stake is not null)), 'target', 1, 'points', 5)
  )
$$;
grant execute on function public.weekly_quests(uuid) to authenticated;

create or replace function public.quest_points(p_player uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum((q ->> 'points')::int) filter (where (q ->> 'progress')::int >= (q ->> 'target')::int), 0)::int
  from jsonb_array_elements(public.weekly_quests(p_player)) q
$$;
grant execute on function public.quest_points(uuid) to authenticated;

-- Discord notifications through pg_net. URL lives in app_settings ('discord_webhook_url'); empty = off.
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available: %', sqlerrm;
end $$;
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('discord_webhook_url', '') on conflict (key) do nothing;

create or replace function public.notify_discord(p_message text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := (select value from public.app_settings where key = 'discord_webhook_url');
begin
  if coalesce(v_url, '') = '' then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('content', p_message, 'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  null;
end $$;

create or replace function public.player_name(p_id uuid) returns text
language sql stable as $$ select coalesce((select name from public.players where id = p_id), 'iemand') $$;

create or replace function public.discord_on_battle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_msg text;
  v_gym text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    v_gym := case when new.gym_id is not null then ' voor ' || (select name from public.gyms where id = new.gym_id) else '' end;
    v_msg := '⚔️ **' || public.player_name(new.challenger_id) || '** daagt **' || public.player_name(new.opponent_id) || '** uit' ||
      case when new.gym_id is not null then ' (gym-uitdaging' || v_gym || ')' when new.champion_match then ' voor de Champion-titel!' when new.tournament_match_id is not null then ' (toernooiwedstrijd)' else '' end ||
      case when new.stake is not null then '. Inzet: _' || new.stake || '_' else '' end;
    perform public.notify_discord(v_msg);
  elsif tg_op = 'UPDATE' and new.status = 'finished' and old.status <> 'finished' then
    v_msg := '🏆 **' || public.player_name(new.winner_id) || '** verslaat **' ||
      public.player_name(case when new.winner_id = new.challenger_id then new.opponent_id else new.challenger_id end) || '**' ||
      ' (+' || coalesce(new.rating_delta, 0) || ' rating)';
    if new.gym_id is not null then
      v_msg := v_msg || case when new.winner_id = new.challenger_id then ' en neemt **' || (select name from public.gyms where id = new.gym_id) || '** over met een badge!' else ' en verdedigt **' || (select name from public.gyms where id = new.gym_id) || '**.' end;
    end if;
    if new.champion_match and new.winner_id = new.challenger_id then v_msg := v_msg || ' 👑 Nieuwe Champion!'; end if;
    if new.stake is not null then v_msg := v_msg || ' Inzet: _' || new.stake || '_'; end if;
    perform public.notify_discord(v_msg);
  end if;
  return new;
end $$;
drop trigger if exists discord_on_battle on public.battles;
create trigger discord_on_battle after insert or update on public.battles for each row execute function public.discord_on_battle();

create or replace function public.discord_on_gym() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.leader_id is not null and (old.leader_id is null or old.leader_id <> new.leader_id) then
    perform public.notify_discord('🏟️ **' || public.player_name(new.leader_id) || '** is nu gymleader van **' || new.name || '**');
  elsif new.leader_id is null and old.leader_id is not null then
    perform public.notify_discord('🏟️ **' || new.name || '** heeft geen leader meer. Wie claimt hem?');
  end if;
  return new;
end $$;
drop trigger if exists discord_on_gym on public.gyms;
create trigger discord_on_gym after update on public.gyms for each row execute function public.discord_on_gym();

create or replace function public.discord_on_tournament() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify_discord('🎟️ Nieuw toernooi: **' || new.name || '** door ' || public.player_name(new.created_by) || '. Schrijf je in via de arena!');
  elsif new.status = 'running' and old.status = 'open' then
    perform public.notify_discord('🎟️ Toernooi **' || new.name || '** is gestart met ' || (select count(*) from public.tournament_players where tournament_id = new.id) || ' deelnemers.');
  elsif new.status = 'finished' and old.status <> 'finished' then
    perform public.notify_discord('🥇 **' || public.player_name(new.winner_id) || '** wint toernooi **' || new.name || '**!');
  end if;
  return new;
end $$;
drop trigger if exists discord_on_tournament on public.tournaments;
create trigger discord_on_tournament after insert or update on public.tournaments for each row execute function public.discord_on_tournament();

create or replace function public.set_discord_webhook(p_url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_url <> '' and p_url not like 'https://discord.com/api/webhooks/%' and p_url not like 'https://discordapp.com/api/webhooks/%' then
    raise exception 'Dat is geen Discord-webhook-URL';
  end if;
  insert into public.app_settings (key, value) values ('discord_webhook_url', p_url)
  on conflict (key) do update set value = excluded.value;
end $$;
grant execute on function public.set_discord_webhook(text) to authenticated;

create or replace function public.discord_configured() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'discord_webhook_url'), '') <> ''
$$;
grant execute on function public.discord_configured() to authenticated;

alter publication supabase_realtime add table public.tournaments;
alter publication supabase_realtime add table public.tournament_matches;
