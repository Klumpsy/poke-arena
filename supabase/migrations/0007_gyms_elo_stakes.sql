-- v2: Elo rating, gyms (king of the hill), badges, stakes/debts.
alter table public.players add column if not exists rating int not null default 1000;
alter table public.players add column if not exists last_seen_at timestamptz not null default now();

create table if not exists public.gyms (
  id text primary key,
  name text not null,
  type text not null,
  sort int not null,
  leader_id uuid references public.players (id) on delete set null,
  claimed_at timestamptz
);
alter table public.gyms enable row level security;
create policy "gyms readable" on public.gyms for select to authenticated using (true);
insert into public.gyms (id, name, type, sort) values
  ('fire', 'Vulkaan Gym', 'fire', 1),
  ('water', 'Haven Gym', 'water', 2),
  ('grass', 'Kas Gym', 'grass', 3),
  ('electric', 'Serverruimte Gym', 'electric', 4),
  ('psychic', 'Brainstorm Gym', 'psychic', 5),
  ('fighting', 'Sportschool Gym', 'fighting', 6),
  ('ghost', 'Archief Gym', 'ghost', 7),
  ('dragon', 'Directie Gym', 'dragon', 8)
on conflict (id) do nothing;

alter table public.battles add column if not exists gym_id text references public.gyms (id) on delete set null;
alter table public.battles add column if not exists stake text;
alter table public.battles add column if not exists rating_delta int;

create table if not exists public.badges (
  player_id uuid not null references public.players (id) on delete cascade,
  gym_id text not null references public.gyms (id) on delete cascade,
  earned_at timestamptz not null default now(),
  beaten_leader_id uuid references public.players (id) on delete set null,
  battle_id uuid references public.battles (id) on delete set null,
  primary key (player_id, gym_id)
);
alter table public.badges enable row level security;
create policy "badges readable" on public.badges for select to authenticated using (true);

create table if not exists public.gym_cooldowns (
  player_id uuid not null references public.players (id) on delete cascade,
  gym_id text not null references public.gyms (id) on delete cascade,
  until timestamptz not null,
  primary key (player_id, gym_id)
);
alter table public.gym_cooldowns enable row level security;
create policy "cooldowns readable" on public.gym_cooldowns for select to authenticated using (true);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  battle_id uuid references public.battles (id) on delete set null,
  debtor_id uuid not null references public.players (id) on delete cascade,
  creditor_id uuid not null references public.players (id) on delete cascade,
  stake text not null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.debts enable row level security;
create policy "debts readable" on public.debts for select to authenticated using (true);

-- Heartbeat for inactivity rules.
create or replace function public.heartbeat() returns void
language sql security definer set search_path = public as $$
  update public.players set last_seen_at = now() where id = auth.uid()
$$;
grant execute on function public.heartbeat() to authenticated;

-- Leaders inactive for 14 days lose their gym.
create or replace function public.release_stale_gyms() returns void
language sql security definer set search_path = public as $$
  update public.gyms g set leader_id = null, claimed_at = null
  from public.players p
  where g.leader_id = p.id and p.last_seen_at < now() - interval '14 days'
$$;

-- Species type lookup lives in the database too, kept in sync from data/pokemon.json by the migration below.
create table if not exists public.species (
  id int primary key,
  name text not null,
  types jsonb not null
);
alter table public.species enable row level security;
create policy "species readable" on public.species for select to anon, authenticated using (true);
create or replace function public.species_types(p_species int) returns jsonb
language sql stable as $$ select coalesce((select types from public.species where id = p_species), '[]'::jsonb) $$;

create or replace function public.team_has_type(p_player uuid, p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_snapshot(p_player) ts, jsonb_array_elements(ts -> 'pokemon') p
    where exists (select 1 from jsonb_array_elements_text(public.species_types((p ->> 'speciesId')::int)) t where t = p_type)
  )
$$;

-- The highest-rated player without a gym may claim an empty gym.
create or replace function public.next_claimant() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from public.players p
  where not exists (select 1 from public.gyms g where g.leader_id = p.id)
    and exists (select 1 from public.teams t where t.player_id = p.id)
  order by p.rating desc, p.wins desc, p.created_at asc
  limit 1
$$;
grant execute on function public.next_claimant() to authenticated;

create or replace function public.claim_gym(p_gym text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.gyms;
begin
  perform public.release_stale_gyms();
  select * into g from public.gyms where id = p_gym for update;
  if g.id is null then raise exception 'Onbekende gym'; end if;
  if g.leader_id is not null then raise exception 'Deze gym heeft al een leader'; end if;
  if public.next_claimant() <> auth.uid() then raise exception 'Jij bent nog niet aan de beurt om een gym te claimen'; end if;
  if not public.team_has_type(auth.uid(), g.type) then
    raise exception 'Je team heeft geen %-type Pokémon', g.type;
  end if;
  update public.gyms set leader_id = auth.uid(), claimed_at = now() where id = p_gym;
end $$;
grant execute on function public.claim_gym(text) to authenticated;

create or replace function public.release_gym() returns void
language sql security definer set search_path = public as $$
  update public.gyms set leader_id = null, claimed_at = null where leader_id = auth.uid()
$$;
grant execute on function public.release_gym() to authenticated;

-- Challenges go through this function so gym rules and stakes are enforced server-side.
create or replace function public.challenge(p_opponent uuid, p_gym text default null, p_stake text default null) returns public.battles
language plpgsql security definer set search_path = public as $$
declare
  g public.gyms;
  b public.battles;
  v_stake text := nullif(trim(coalesce(p_stake, '')), '');
begin
  if p_opponent = auth.uid() then raise exception 'Je kunt jezelf niet uitdagen'; end if;
  if not exists (select 1 from public.teams where player_id = auth.uid()) then raise exception 'Kies eerst een team'; end if;
  if exists (select 1 from public.battles where status in ('pending', 'active') and auth.uid() in (challenger_id, opponent_id)) then
    raise exception 'Je hebt al een openstaand gevecht';
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
grant execute on function public.challenge(uuid, text, text) to authenticated;
drop policy if exists "battles challenge" on public.battles;

create or replace function public.respond_battle(p_battle uuid, p_accept boolean) returns public.battles
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
  g public.gyms;
  v_mine jsonb;
  v_theirs jsonb;
begin
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
    if not public.team_has_type(auth.uid(), g.type) then
      raise exception 'Als gymleader moet je minstens één %-type Pokémon in je team hebben', g.type;
    end if;
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

create or replace function public.finish_battle(p_battle uuid, p_winner uuid) returns void
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
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  if b.status <> 'active' then return; end if;
  if p_winner not in (b.challenger_id, b.opponent_id) then
    raise exception 'Ongeldige winnaar';
  end if;
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

create or replace function public.settle_debt(p_debt uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.debts set done_at = now()
  where id = p_debt and done_at is null and auth.uid() in (debtor_id, creditor_id);
  if not found then raise exception 'Niet jouw inzet'; end if;
end $$;
grant execute on function public.settle_debt(uuid) to authenticated;

alter publication supabase_realtime add table public.gyms;
alter publication supabase_realtime add table public.debts;
