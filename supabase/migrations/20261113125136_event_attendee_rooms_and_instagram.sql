-- Event attendee rooms and Instagram group links.
-- Existing event rows remain intact; the chat is restricted to attendees and admins.
alter table public.nitra_events
  add column if not exists instagram_group_url text not null default '',
  add column if not exists room_enabled boolean not null default true;

alter table public.nitra_events
  add constraint nitra_events_instagram_group_url_length
    check (char_length(instagram_group_url) <= 500);

create table if not exists public.nitra_event_attendees (
  event_id uuid not null references public.nitra_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.nitra_event_room_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.nitra_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null default 'Nitra Space',
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists nitra_event_room_messages_event_created_idx
  on public.nitra_event_room_messages (event_id, created_at);

alter table public.nitra_event_attendees enable row level security;
alter table public.nitra_event_room_messages enable row level security;

revoke all on public.nitra_event_attendees, public.nitra_event_room_messages from anon, authenticated;
grant select, insert, delete on public.nitra_event_attendees to authenticated;
grant select, insert, delete on public.nitra_event_room_messages to authenticated;

drop policy if exists nitra_event_attendees_select on public.nitra_event_attendees;
create policy nitra_event_attendees_select on public.nitra_event_attendees
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin((select auth.uid())));

drop policy if exists nitra_event_attendees_join on public.nitra_event_attendees;
create policy nitra_event_attendees_join on public.nitra_event_attendees
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.nitra_events e
      where e.id = event_id and e.room_enabled = true
    )
  );

drop policy if exists nitra_event_attendees_leave on public.nitra_event_attendees;
create policy nitra_event_attendees_leave on public.nitra_event_attendees
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_admin((select auth.uid())));

drop policy if exists nitra_event_room_messages_select on public.nitra_event_room_messages;
create policy nitra_event_room_messages_select on public.nitra_event_room_messages
  for select to authenticated
  using (
    private.is_admin((select auth.uid()))
    or exists (
      select 1 from public.nitra_event_attendees a
      where a.event_id = nitra_event_room_messages.event_id
        and a.user_id = (select auth.uid())
    )
  );

drop policy if exists nitra_event_room_messages_send on public.nitra_event_room_messages;
create policy nitra_event_room_messages_send on public.nitra_event_room_messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.nitra_event_attendees a
      where a.event_id = nitra_event_room_messages.event_id
        and a.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.nitra_events e
      where e.id = nitra_event_room_messages.event_id and e.room_enabled = true
    )
  );

drop policy if exists nitra_event_room_messages_delete on public.nitra_event_room_messages;
create policy nitra_event_room_messages_delete on public.nitra_event_room_messages
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_admin((select auth.uid())));

create or replace function private.stamp_event_room_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(nullif(btrim(p.display_name), ''), p.username, 'Nitra Space')
    into new.author_name
  from public.profiles p
  where p.id = new.user_id;
  if new.author_name is null then new.author_name := 'Nitra Space'; end if;
  return new;
end;
$$;
revoke all on function private.stamp_event_room_author() from public, anon, authenticated;
drop trigger if exists nitra_event_room_author on public.nitra_event_room_messages;
create trigger nitra_event_room_author
  before insert on public.nitra_event_room_messages
  for each row execute function private.stamp_event_room_author();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nitra_event_room_messages'
  ) then
    alter publication supabase_realtime add table public.nitra_event_room_messages;
  end if;
end;
$$;

-- Preserve the existing admin RPC signature used by the event editor.
create or replace function public.manage_nitra_event(
  p_password text,
  p_action text,
  p_event jsonb default '{}'::jsonb,
  p_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.nitra_events;
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'Admin prístup je potrebný.' using errcode = '42501';
  end if;

  if p_action = 'insert' then
    insert into public.nitra_events (
      id, organizer, title, performer, event_date, place, link, image_data,
      instagram_group_url, room_enabled
    ) values (
      coalesce(p_event_id, gen_random_uuid()),
      btrim(p_event->>'organizer'), btrim(p_event->>'title'),
      btrim(p_event->>'performer'), (p_event->>'event_date')::timestamptz,
      btrim(p_event->>'place'), coalesce(btrim(p_event->>'link'), ''),
      coalesce(p_event->>'image_data', ''),
      coalesce(btrim(p_event->>'instagram_group_url'), ''),
      coalesce((p_event->>'room_enabled')::boolean, true)
    )
    on conflict (id) do update set
      organizer=excluded.organizer, title=excluded.title,
      performer=excluded.performer, event_date=excluded.event_date,
      place=excluded.place, link=excluded.link, image_data=excluded.image_data,
      instagram_group_url=excluded.instagram_group_url,
      room_enabled=excluded.room_enabled, updated_at=now()
    returning * into result_row;
  elsif p_action = 'update' then
    if p_event_id is null then raise exception 'Chýba ID eventu.'; end if;
    update public.nitra_events set
      organizer=btrim(p_event->>'organizer'), title=btrim(p_event->>'title'),
      performer=btrim(p_event->>'performer'),
      event_date=(p_event->>'event_date')::timestamptz,
      place=btrim(p_event->>'place'), link=coalesce(btrim(p_event->>'link'),''),
      image_data=coalesce(p_event->>'image_data',''),
      instagram_group_url=coalesce(btrim(p_event->>'instagram_group_url'), ''),
      room_enabled=coalesce((p_event->>'room_enabled')::boolean, true), updated_at=now()
    where id=p_event_id returning * into result_row;
    if result_row.id is null then raise exception 'Event sa nenašiel.'; end if;
  elsif p_action = 'delete' then
    if p_event_id is null then raise exception 'Chýba ID eventu.'; end if;
    delete from public.nitra_events where id=p_event_id returning * into result_row;
    if result_row.id is null then raise exception 'Event sa nenašiel.'; end if;
  else
    raise exception 'Neplatná admin operácia.';
  end if;

  return to_jsonb(result_row);
end;
$$;

revoke all on function public.manage_nitra_event(text,text,jsonb,uuid) from public, anon;
grant execute on function public.manage_nitra_event(text,text,jsonb,uuid) to authenticated;
