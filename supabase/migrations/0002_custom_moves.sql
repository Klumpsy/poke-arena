-- Players may pick 4 moves from the species' level-up learnset. Sync never touches this column.
alter table public.pokemon add column if not exists custom_moves jsonb;

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
      'gender', p.gender
    ) order by ord
  ), '[]'::jsonb))
  from public.teams t
  cross join unnest(t.pokemon_ids) with ordinality as u(pokemon_id, ord)
  join public.pokemon p on p.id = u.pokemon_id and p.player_id = t.player_id
  where t.player_id = p_player
$$;

create or replace function public.set_moves(p_pokemon uuid, p_moves jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) not between 1 and 4 then
    raise exception 'Kies 1 tot 4 moves';
  end if;
  if exists (select 1 from jsonb_array_elements(p_moves) m where jsonb_typeof(m) <> 'string') then
    raise exception 'Ongeldige move';
  end if;
  update public.pokemon set custom_moves = p_moves where id = p_pokemon and player_id = auth.uid();
  if not found then
    raise exception 'Niet jouw Pokémon';
  end if;
end $$;

grant execute on function public.set_moves(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
