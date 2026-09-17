-- Name + password accounts. The app builds an internal address <slug>@players.poke-arena, no mail is ever sent
-- (mailer autoconfirm is on). Real cube.nl addresses remain allowed for existing accounts.
create or replace function public.allowed_email_domains() returns text[]
language sql immutable as $$ select array['cube.nl', 'players.poke-arena'] $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  domain text := split_part(coalesce(new.email, ''), '@', 2);
  display_name text := trim(coalesce(new.raw_user_meta_data ->> 'name', ''));
begin
  if new.is_anonymous then
    raise exception 'Anonieme accounts zijn uitgeschakeld';
  end if;
  if not (domain = any (public.allowed_email_domains())) then
    raise exception 'Alleen e-mailadressen van % zijn toegestaan', array_to_string(public.allowed_email_domains(), ', ');
  end if;
  if display_name = '' then
    display_name := initcap(replace(split_part(new.email, '@', 1), '.', ' '));
  end if;
  if length(display_name) < 2 or length(display_name) > 30 then
    raise exception 'Vul een naam in van 2 tot 30 tekens';
  end if;
  insert into public.players (id, email, name) values (new.id, new.email, display_name);
  insert into public.sync_tokens (player_id) values (new.id);
  return new;
end $$;
