-- Anonymous rooms use short local aliases, not full official school names or
-- logos. Anonymous Supabase users are scoped to these rooms.
create table if not exists public.school_chat_rooms (
  id smallint primary key check (id between 1 and 24),
  label text not null unique check (char_length(label) <= 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.school_chat_rooms (id, label) values
  (1, 'Animus'),
  (2, 'Obchodka'),
  (3, 'Cabajská · stavebná'),
  (4, 'Cabajská · potravinárska'),
  (5, 'Cintorínska'),
  (6, 'Červeňova'),
  (7, 'Veterina'),
  (8, 'GCM'),
  (9, 'Zdravotka'),
  (10, 'Fraňa Kráľa'),
  (11, 'Golianka'),
  (12, 'Konzervatórium'),
  (13, 'Gastro'),
  (14, 'Nábrežie'),
  (15, 'Polytechnika'),
  (16, 'Párovská'),
  (17, 'Piaristi'),
  (18, 'Samova'),
  (19, 'Slančíkova · gym'),
  (20, 'Hotelovka'),
  (21, 'Slančíkova · potravinárska'),
  (22, 'Športová')
on conflict (id) do update set label = excluded.label, is_active = true;

-- Hide the two surplus generic preview rooms from an earlier draft.
update public.school_chat_rooms set is_active = false where id > 22;

-- The existing account trigger creates a full social profile and requires a
-- birth date. Guest room sessions intentionally do not create social profiles.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 50);
  v_username_base text;
  v_username text;
  v_birth_date date;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') = 'anonymous' then
    return new;
  end if;
  begin
    v_birth_date := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then
    raise exception 'Invalid birth date';
  end;
  if v_birth_date > current_date - interval '16 years' then
    raise exception 'Social accounts require age 16 or older';
  end if;
  if v_display_name = '' then v_display_name := 'Používateľ'; end if;
  if v_requested_username ~ '^[a-z0-9_]{3,24}$'
     and not exists (select 1 from public.profiles p where p.username = v_requested_username) then
    v_username := v_requested_username;
  else
    v_username_base := trim(both '_' from regexp_replace(lower(v_display_name), '[^a-z0-9]+', '_', 'g'));
    if char_length(v_username_base) < 3 then v_username_base := 'user'; end if;
    v_username := left(v_username_base, 15) || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;
  insert into public.profiles(id, username, display_name, birth_date, city, location_id)
  values (new.id, v_username, v_display_name, v_birth_date, 'Nitra', 'nitra');
  insert into public.matching_profiles(user_id) values (new.id);
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create table if not exists public.school_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id smallint not null references public.school_chat_rooms(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Hosť',
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists school_chat_messages_room_created_idx
  on public.school_chat_messages (room_id, created_at desc);

alter table public.school_chat_rooms enable row level security;
alter table public.school_chat_messages enable row level security;
revoke all on public.school_chat_rooms, public.school_chat_messages from anon, authenticated;
grant select on public.school_chat_rooms to authenticated;
grant select, insert, delete on public.school_chat_messages to authenticated;

drop policy if exists school_chat_rooms_read_anonymous on public.school_chat_rooms;
create policy school_chat_rooms_read_anonymous
  on public.school_chat_rooms for select to authenticated
  using (is_active and coalesce((select auth.jwt()->>'is_anonymous')::boolean, false));

drop policy if exists school_chat_messages_read_anonymous on public.school_chat_messages;
create policy school_chat_messages_read_anonymous
  on public.school_chat_messages for select to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false));

drop policy if exists school_chat_messages_send_anonymous on public.school_chat_messages;
create policy school_chat_messages_send_anonymous
  on public.school_chat_messages for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and coalesce((select auth.jwt()->>'is_anonymous')::boolean, false)
    and exists (select 1 from public.school_chat_rooms r where r.id = room_id and r.is_active)
  );

drop policy if exists school_chat_messages_delete_own on public.school_chat_messages;
create policy school_chat_messages_delete_own
  on public.school_chat_messages for delete to authenticated
  using (author_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous')::boolean, false));

create or replace function private.stamp_school_chat_guest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  guest_id uuid := auth.uid();
begin
  if guest_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) is not true then
    raise exception 'Anonymous room session required';
  end if;
  new.author_id := guest_id;
  new.author_name := 'Hosť ' || upper(substr(replace(guest_id::text, '-', ''), 1, 4));
  return new;
end;
$$;

revoke all on function private.stamp_school_chat_guest() from public, anon, authenticated;
drop trigger if exists school_chat_stamp_guest on public.school_chat_messages;
create trigger school_chat_stamp_guest
  before insert on public.school_chat_messages
  for each row execute function private.stamp_school_chat_guest();

-- Anonymous accounts share the authenticated database role; keep them out of
-- the existing account-only global and event chats.
drop policy if exists global_chat_block_anonymous on public.global_chat_messages;
create policy global_chat_block_anonymous
  on public.global_chat_messages as restrictive for all to authenticated
  using (not coalesce((select auth.jwt()->>'is_anonymous')::boolean, false))
  with check (not coalesce((select auth.jwt()->>'is_anonymous')::boolean, false));

drop policy if exists event_attendees_block_anonymous on public.nitra_event_attendees;
create policy event_attendees_block_anonymous
  on public.nitra_event_attendees as restrictive for all to authenticated
  using (not coalesce((select auth.jwt()->>'is_anonymous')::boolean, false))
  with check (not coalesce((select auth.jwt()->>'is_anonymous')::boolean, false));

drop policy if exists event_room_messages_block_anonymous on public.nitra_event_room_messages;
create policy event_room_messages_block_anonymous
  on public.nitra_event_room_messages as restrictive for all to authenticated
  using (not coalesce((select auth.jwt()->>'is_anonymous')::boolean, false))
  with check (not coalesce((select auth.jwt()->>'is_anonymous')::boolean, false));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'school_chat_messages'
     ) then
    alter publication supabase_realtime add table public.school_chat_messages;
  end if;
end $$;
