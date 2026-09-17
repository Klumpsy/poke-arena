-- Who is in an active battle right now, visible to everyone (battles themselves stay private).
create or replace function public.busy_players() returns setof uuid
language sql stable security definer set search_path = public as $$
  select challenger_id from public.battles where status = 'active'
  union
  select opponent_id from public.battles where status = 'active'
$$;
grant execute on function public.busy_players() to authenticated;
