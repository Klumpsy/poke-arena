-- Login by name only: Supabase anonymous users carry their display name in raw_user_meta_data.
alter table public.players alter column email drop not null;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  domain text := split_part(coalesce(new.email, ''), '@', 2);
  display_name text := trim(coalesce(new.raw_user_meta_data ->> 'name', ''));
begin
  if new.is_anonymous then
    if length(display_name) < 2 or length(display_name) > 30 then
      raise exception 'Vul een naam in van 2 tot 30 tekens';
    end if;
  else
    if not (domain = any (public.allowed_email_domains())) then
      raise exception 'Alleen e-mailadressen van % zijn toegestaan', array_to_string(public.allowed_email_domains(), ', ');
    end if;
    display_name := initcap(replace(split_part(new.email, '@', 1), '.', ' '));
  end if;
  insert into public.players (id, email, name) values (new.id, new.email, display_name);
  insert into public.sync_tokens (player_id) values (new.id);
  return new;
end $$;

create or replace function public.rename_player(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(p_name)) < 2 or length(trim(p_name)) > 30 then
    raise exception 'Vul een naam in van 2 tot 30 tekens';
  end if;
  update public.players set name = trim(p_name) where id = auth.uid();
end $$;
grant execute on function public.rename_player(text) to authenticated;
