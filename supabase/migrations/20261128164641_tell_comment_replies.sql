alter table public.tell_comments
  add column reply_to uuid,
  add constraint tell_comments_id_tell_key unique (id, tell_id),
  add constraint tell_comments_reply_fk foreign key (reply_to, tell_id)
    references public.tell_comments (id, tell_id) on delete set null (reply_to);
create index tell_comments_thread_idx on public.tell_comments (tell_id, reply_to, created_at, id);
grant insert(reply_to) on public.tell_comments to authenticated;

alter policy comments_add on public.tell_comments with check (
  (select private.tells_member())
  and user_id = (select auth.uid())
  and (reply_to is null or exists (
    select 1 from public.tell_comments parent
    where parent.id = tell_comments.reply_to
      and parent.tell_id = tell_comments.tell_id
      and parent.reply_to is null
  ))
);
