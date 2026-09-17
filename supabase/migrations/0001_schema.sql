-- Poke Arena schema. Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null,
  last_sync_at timestamptz,
  wins int not null default 0,
  losses int not null default 0,
  created_at timestamptz not null default now()
);

create table public.sync_tokens (
  token text primary key default encode(gen_random_bytes(24), 'hex'),
  player_id uuid not null unique references public.players (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.pokemon (
  id uuid primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  species_id int not null,
  level int not null,
  nature text not null,
  ivs jsonb not null,
  moves jsonb not null,
  shiny boolean not null default false,
  gender text not null default 'genderless',
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);
create index pokemon_player_idx on public.pokemon (player_id);

create table public.teams (
  player_id uuid primary key references public.players (id) on delete cascade,
  pokemon_ids uuid[] not null check (array_length(pokemon_ids, 1) between 1 and 3),
  updated_at timestamptz not null default now()
);

create table public.battles (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.players (id) on delete cascade,
  opponent_id uuid not null references public.players (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'finished', 'declined', 'cancelled')),
  seed bigint not null default floor(random() * 2147483647),
  challenger_team jsonb,
  opponent_team jsonb,
  winner_id uuid references public.players (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (challenger_id <> opponent_id)
);
create index battles_opponent_idx on public.battles (opponent_id, status);
create index battles_challenger_idx on public.battles (challenger_id, status);

create table public.battle_actions (
  battle_id uuid not null references public.battles (id) on delete cascade,
  turn int not null,
  player_id uuid not null references public.players (id) on delete cascade,
  action jsonb not null,
  created_at timestamptz not null default now(),
  primary key (battle_id, turn, player_id)
);

-- Signup: restrict domain, create player + sync token.
create or replace function public.allowed_email_domains() returns text[]
language sql immutable as $$ select array['cube.nl'] $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  domain text := split_part(new.email, '@', 2);
begin
  if not (domain = any (public.allowed_email_domains())) then
    raise exception 'Alleen e-mailadressen van % zijn toegestaan', array_to_string(public.allowed_email_domains(), ', ');
  end if;
  insert into public.players (id, email, name)
  values (new.id, new.email, initcap(replace(split_part(new.email, '@', 1), '.', ' ')));
  insert into public.sync_tokens (player_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the current user part of this battle?
create or replace function public.is_battle_participant(p_battle uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.battles b
    where b.id = p_battle and auth.uid() in (b.challenger_id, b.opponent_id)
  )
$$;

-- Sync from the Mac helper. Called with the anon key, authenticated by the per-player token.
create or replace function public.sync_pokedex(p_token text, p_state jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid;
  v_ids uuid[] := '{}';
  v_entry jsonb;
  v_profile jsonb;
  v_id uuid;
  v_species int;
  v_stage int;
begin
  select player_id into v_player from public.sync_tokens where token = p_token;
  if v_player is null then
    raise exception 'Ongeldige sync-token' using errcode = '28000';
  end if;

  -- Active companion: species is the current stage in its evolution path.
  v_entry := p_state -> 'active';
  if v_entry is not null and (v_entry -> 'profile' ->> 'instanceID') is not null then
    v_profile := (v_entry -> 'profile') || jsonb_build_object('nature', v_entry ->> 'nature');
    v_id := (v_profile ->> 'instanceID')::uuid;
    v_stage := coalesce((v_entry ->> 'stageIndex')::int, 0);
    v_species := coalesce((v_entry -> 'pathIDs' ->> v_stage)::int, (v_entry ->> 'baseID')::int);
    perform public.upsert_pokemon(v_player, v_id, v_species, v_profile, coalesce((v_entry ->> 'isShiny')::boolean, false), true);
    v_ids := v_ids || v_id;
  end if;

  -- Completed dex entries: final form.
  for v_entry in select * from jsonb_array_elements(coalesce(p_state -> 'dex', '[]'::jsonb)) loop
    v_profile := (v_entry -> 'profile') || jsonb_build_object('nature', v_entry ->> 'nature');
    if (v_profile ->> 'instanceID') is null then continue; end if;
    v_id := (v_profile ->> 'instanceID')::uuid;
    v_species := coalesce((v_entry ->> 'finalID')::int, (v_entry ->> 'baseID')::int);
    perform public.upsert_pokemon(v_player, v_id, v_species, v_profile, coalesce((v_entry ->> 'isShiny')::boolean, false), false);
    v_ids := v_ids || v_id;
  end loop;

  delete from public.pokemon where player_id = v_player and not (id = any (v_ids));
  update public.players set last_sync_at = now() where id = v_player;

  return jsonb_build_object('synced', coalesce(array_length(v_ids, 1), 0));
end $$;

create or replace function public.upsert_pokemon(
  p_player uuid, p_id uuid, p_species int, p_profile jsonb, p_shiny boolean, p_active boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ivs jsonb := p_profile -> 'ivs';
begin
  insert into public.pokemon (id, player_id, species_id, level, nature, ivs, moves, shiny, gender, is_active, updated_at)
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
      'moves', p.moves,
      'shiny', p.shiny,
      'gender', p.gender
    ) order by ord
  ), '[]'::jsonb))
  from public.teams t
  cross join unnest(t.pokemon_ids) with ordinality as u(pokemon_id, ord)
  join public.pokemon p on p.id = u.pokemon_id and p.player_id = t.player_id
  where t.player_id = p_player
$$;

create or replace function public.respond_battle(p_battle uuid, p_accept boolean) returns public.battles
language plpgsql security definer set search_path = public as $$
declare
  b public.battles;
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
begin
  select * into b from public.battles where id = p_battle for update;
  if b.id is null or auth.uid() not in (b.challenger_id, b.opponent_id) then
    raise exception 'Niet jouw gevecht';
  end if;
  if b.status <> 'active' then return; end if;
  if p_winner not in (b.challenger_id, b.opponent_id) then
    raise exception 'Ongeldige winnaar';
  end if;
  update public.battles set status = 'finished', winner_id = p_winner, finished_at = now() where id = p_battle;
  update public.players set wins = wins + 1 where id = p_winner;
  update public.players set losses = losses + 1
    where id = case when p_winner = b.challenger_id then b.opponent_id else b.challenger_id end;
end $$;

create or replace function public.regenerate_sync_token() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  delete from public.sync_tokens where player_id = auth.uid();
  insert into public.sync_tokens (player_id) values (auth.uid()) returning token into v_token;
  return v_token;
end $$;

-- Row level security
alter table public.players enable row level security;
alter table public.sync_tokens enable row level security;
alter table public.pokemon enable row level security;
alter table public.teams enable row level security;
alter table public.battles enable row level security;
alter table public.battle_actions enable row level security;

create policy "players readable by everyone signed in" on public.players for select to authenticated using (true);
create policy "players update own name" on public.players for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "own sync token" on public.sync_tokens for select to authenticated using (player_id = auth.uid());

create policy "pokemon readable by everyone signed in" on public.pokemon for select to authenticated using (true);

create policy "teams readable" on public.teams for select to authenticated using (true);
create policy "teams insert own" on public.teams for insert to authenticated with check (player_id = auth.uid());
create policy "teams update own" on public.teams for update to authenticated using (player_id = auth.uid()) with check (player_id = auth.uid());

create policy "battles visible to participants" on public.battles for select to authenticated
  using (auth.uid() in (challenger_id, opponent_id));
create policy "battles challenge" on public.battles for insert to authenticated
  with check (challenger_id = auth.uid() and status = 'pending');
create policy "battles cancel own pending" on public.battles for update to authenticated
  using (challenger_id = auth.uid() and status = 'pending')
  with check (challenger_id = auth.uid() and status = 'cancelled');

create policy "actions visible to participants" on public.battle_actions for select to authenticated
  using (public.is_battle_participant(battle_id));
create policy "actions insert own" on public.battle_actions for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (select 1 from public.battles b where b.id = battle_id and b.status = 'active' and auth.uid() in (b.challenger_id, b.opponent_id))
  );

grant execute on function public.sync_pokedex(text, jsonb) to anon, authenticated;
grant execute on function public.respond_battle(uuid, boolean) to authenticated;
grant execute on function public.finish_battle(uuid, uuid) to authenticated;
grant execute on function public.regenerate_sync_token() to authenticated;
grant execute on function public.team_snapshot(uuid) to authenticated;
revoke execute on function public.upsert_pokemon(uuid, uuid, int, jsonb, boolean, boolean) from public, anon, authenticated;

alter publication supabase_realtime add table public.battles;
alter publication supabase_realtime add table public.battle_actions;
