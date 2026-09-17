-- Keep the last raw PokeTokenBar state per player so unknown formats can be inspected and supported.
create table if not exists public.sync_payloads (
  player_id uuid primary key references public.players (id) on delete cascade,
  state jsonb not null,
  synced int not null default 0,
  received_at timestamptz not null default now()
);
alter table public.sync_payloads enable row level security;

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
  if v_entry is not null and (v_entry -> 'profile' ->> 'instanceID') is not null then
    v_profile := (v_entry -> 'profile') || jsonb_build_object('nature', v_entry ->> 'nature');
    v_id := (v_profile ->> 'instanceID')::uuid;
    v_stage := coalesce((v_entry ->> 'stageIndex')::int, 0);
    v_species := coalesce((v_entry -> 'pathIDs' ->> v_stage)::int, (v_entry ->> 'baseID')::int);
    perform public.upsert_pokemon(v_player, v_id, v_species, v_profile, coalesce((v_entry ->> 'isShiny')::boolean, false), true);
    v_ids := v_ids || v_id;
  end if;

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
  insert into public.sync_payloads (player_id, state, synced, received_at)
  values (v_player, p_state, coalesce(array_length(v_ids, 1), 0), now())
  on conflict (player_id) do update set state = excluded.state, synced = excluded.synced, received_at = now();

  return jsonb_build_object('synced', coalesce(array_length(v_ids, 1), 0));
end $$;
