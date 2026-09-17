-- Empty gyms: first come, first served. One gym per player, team must contain the gym type.
create or replace function public.claim_gym(p_gym text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g public.gyms;
begin
  perform public.release_stale_gyms();
  select * into g from public.gyms where id = p_gym for update;
  if g.id is null then raise exception 'Onbekende gym'; end if;
  if g.leader_id is not null then raise exception 'Deze gym heeft net een leader gekregen'; end if;
  if exists (select 1 from public.gyms where leader_id = auth.uid()) then raise exception 'Je leidt al een gym'; end if;
  if not exists (select 1 from public.teams where player_id = auth.uid()) then raise exception 'Kies eerst een team'; end if;
  if not public.team_has_type(auth.uid(), g.type) then
    raise exception 'Je team heeft geen %-type Pokémon', g.type;
  end if;
  update public.gyms set leader_id = auth.uid(), claimed_at = now() where id = p_gym;
end $$;
