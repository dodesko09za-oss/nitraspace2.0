grant delete on public.tell_comments to authenticated;
create policy comments_remove on public.tell_comments for delete to authenticated
using ((select private.tells_member()) and (user_id = (select auth.uid()) or (select public.is_admin())));
create policy comments_moderate_read on public.tell_comments for select to authenticated
using ((select private.tells_member()) and (select public.is_admin()));

create table public.tell_comment_likes (
  comment_id uuid not null references public.tell_comments(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (comment_id, user_id)
);
create index tell_comment_likes_user_idx on public.tell_comment_likes(user_id);
alter table public.tell_comment_likes enable row level security;
revoke all on public.tell_comment_likes from public, anon, authenticated;
grant select, insert(comment_id), delete on public.tell_comment_likes to authenticated;
create policy comment_likes_read on public.tell_comment_likes for select to authenticated
using (exists (select 1 from public.tell_comments where id = comment_id));
create policy comment_likes_add on public.tell_comment_likes for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.tell_comments where id = comment_id));
create policy comment_likes_remove on public.tell_comment_likes for delete to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.tell_comments where id = comment_id));
