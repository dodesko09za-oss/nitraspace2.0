create function private.tells_member() returns boolean
language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->'app_metadata'->>'auth_provider', '') = 'clerk'
    and coalesce(auth.jwt()->'app_metadata'->>'clerk_user_id', '') <> ''
    and not private.account_is_banned(auth.uid())
$$;
revoke all on function private.tells_member() from public, anon;
grant execute on function private.tells_member() to authenticated;

create function private.tells_username() returns text
language sql stable security invoker set search_path = '' as $$
  select username from public.profiles where id = auth.uid()
$$;
revoke all on function private.tells_username() from public, anon;
grant execute on function private.tells_username() to authenticated;

create table public.unreleased_tells (
  id uuid primary key default gen_random_uuid(),
  photo_path text not null unique check (photo_path ~ '^[a-f0-9-]{36}[.]jpg$'),
  body text not null default '' check (char_length(body) <= 1200),
  created_at timestamptz not null default now()
);
create index unreleased_tells_feed_idx on public.unreleased_tells(created_at desc,id desc);
create table public.tell_likes (
  tell_id uuid not null references public.unreleased_tells on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (tell_id,user_id)
);
create index tell_likes_user_idx on public.tell_likes(user_id);
create table public.tell_comments (
  id uuid primary key default gen_random_uuid(),
  tell_id uuid not null references public.unreleased_tells on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  username text not null default private.tells_username(),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index tell_comments_feed_idx on public.tell_comments(tell_id,created_at,id);
create index tell_comments_user_idx on public.tell_comments(user_id);

alter table public.unreleased_tells enable row level security;
alter table public.tell_likes enable row level security;
alter table public.tell_comments enable row level security;
revoke all on public.unreleased_tells, public.tell_likes, public.tell_comments from public, anon, authenticated;
grant select, insert(body,photo_path) on public.unreleased_tells to authenticated;
grant select, insert(tell_id), delete on public.tell_likes to authenticated;
grant select, insert(tell_id,body) on public.tell_comments to authenticated;

create policy tells_read on public.unreleased_tells for select to authenticated
  using ((select private.tells_member()));
create policy tells_publish on public.unreleased_tells for insert to authenticated
  with check ((select private.tells_member()) and (select public.is_admin()));
create policy likes_read on public.tell_likes for select to authenticated
  using ((select private.tells_member()));
create policy likes_add on public.tell_likes for insert to authenticated
  with check ((select private.tells_member()) and user_id = (select auth.uid()));
create policy likes_remove on public.tell_likes for delete to authenticated
  using ((select private.tells_member()) and user_id = (select auth.uid()));
create policy comments_read on public.tell_comments for select to authenticated
  using ((select private.tells_member()) and not private.account_is_banned(user_id)
    and not private.users_are_blocked((select auth.uid()),user_id));
create policy comments_add on public.tell_comments for insert to authenticated
  with check ((select private.tells_member()) and user_id = (select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('unreleased-tells','unreleased-tells',false,8388608,array['image/jpeg']);

create policy tells_photo_view on storage.objects for select to authenticated
  using (bucket_id = 'unreleased-tells' and (select private.tells_member())
    and ((select public.is_admin()) or exists (
      select 1 from public.unreleased_tells t where t.photo_path = storage.objects.name)));
create policy tells_photo_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'unreleased-tells' and name ~ '^[a-f0-9-]{36}[.]jpg$'
    and (select private.tells_member()) and (select public.is_admin()));
create policy tells_photo_discard on storage.objects for delete to authenticated
  using (bucket_id = 'unreleased-tells' and (select private.tells_member()) and (select public.is_admin())
    and not exists (select 1 from public.unreleased_tells t where t.photo_path = storage.objects.name));
