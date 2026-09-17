-- Older PokeTokenBar versions store no profile (no instanceID, level, IVs or moves). Derive them deterministically.
create or replace function public.legacy_profile(p_player uuid, p_entry jsonb, p_species int, p_level int) returns jsonb
language sql immutable as $$
  with h as (select md5(p_player::text || ':' || p_species::text || ':' || coalesce(p_entry ->> 'baseID', '')) as hex)
  select jsonb_build_object(
    'instanceID', case
      when (p_entry ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_entry ->> 'id')::uuid
      else (substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-4' || substr(hex, 14, 3) || '-a' || substr(hex, 18, 3) || '-' || substr(hex, 21, 12))::uuid
    end,
    'level', p_level,
    'ivs', jsonb_build_object(
      'hp', ('x' || substr(hex, 1, 2))::bit(8)::int % 32,
      'attack', ('x' || substr(hex, 3, 2))::bit(8)::int % 32,
      'defense', ('x' || substr(hex, 5, 2))::bit(8)::int % 32,
      'specialAttack', ('x' || substr(hex, 7, 2))::bit(8)::int % 32,
      'specialDefense', ('x' || substr(hex, 9, 2))::bit(8)::int % 32,
      'speed', ('x' || substr(hex, 11, 2))::bit(8)::int % 32
    ),
    'moves', '[]'::jsonb,
    'gender', case when ('x' || substr(hex, 13, 2))::bit(8)::int % 2 = 0 then 'male' else 'female' end,
    'nature', p_entry ->> 'nature'
  ) from h
$$;

create or replace function public.level_from_tokens(p_tokens numeric) returns int
language sql immutable as $$
  select greatest(1, least(100, 1 + floor(99 * power(least(1, greatest(0, p_tokens) / 750000000.0), 0.67))))::int
$$;

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

  v_entry := p_state -> 'active';
  if v_entry is not null and jsonb_typeof(v_entry) = 'object' and (v_entry ->> 'baseID') is not null then
    v_stage := coalesce((v_entry ->> 'stageIndex')::int, 0);
    v_species := coalesce((v_entry -> 'pathIDs' ->> v_stage)::int, (v_entry ->> 'baseID')::int);
    if (v_entry -> 'profile' ->> 'instanceID') is not null then
      v_profile := (v_entry -> 'profile') || jsonb_build_object('nature', v_entry ->> 'nature');
    else
      v_profile := public.legacy_profile(v_player, v_entry, v_species,
        public.level_from_tokens(coalesce((v_entry ->> 'usedAtStage')::numeric, (v_entry ->> 'growthTokens')::numeric, 0)));
    end if;
    v_id := (v_profile ->> 'instanceID')::uuid;
    perform public.upsert_pokemon(v_player, v_id, v_species, v_profile, coalesce((v_entry ->> 'isShiny')::boolean, false), true);
    v_ids := v_ids || v_id;
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_state -> 'dex', '[]'::jsonb)) loop
    if jsonb_typeof(v_entry) <> 'object' or (v_entry ->> 'baseID') is null then continue; end if;
    v_species := coalesce((v_entry ->> 'finalID')::int, (v_entry ->> 'baseID')::int);
    if (v_entry -> 'profile' ->> 'instanceID') is not null then
      v_profile := (v_entry -> 'profile') || jsonb_build_object('nature', v_entry ->> 'nature');
    else
      v_profile := public.legacy_profile(v_player, v_entry, v_species, 100);
    end if;
    v_id := (v_profile ->> 'instanceID')::uuid;
    if v_id = any (v_ids) then continue; end if;
    perform public.upsert_pokemon(v_player, v_id, v_species, v_profile, coalesce((v_entry ->> 'isShiny')::boolean, false), false);
    v_ids := v_ids || v_id;
  end loop;

  delete from public.pokemon where player_id = v_player and not (id = any (v_ids));
  update public.players set last_sync_at = now() where id = v_player;
  insert into public.sync_payloads (player_id, state, synced, received_at)
  values (v_player, p_state, coalesce(array_length(v_ids, 1), 0), now())
  on conflict (player_id) do update set state = excluded.state, synced = excluded.synced, received_at = now();

  return jsonb_build_object('synced', coalesce(array_length(v_ids, 1), 0));
end $$;
