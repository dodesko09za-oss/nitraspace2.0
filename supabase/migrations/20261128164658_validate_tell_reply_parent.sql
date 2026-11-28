create function private.tell_reply_parent_visible(parent_id uuid, post_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from public.tell_comments parent
    where parent.id = parent_id and parent.tell_id = post_id and parent.reply_to is null
      and (public.is_admin() or (
        not private.account_is_banned(parent.user_id)
        and not private.users_are_blocked(auth.uid(), parent.user_id)
      ))
  );
$function$;
revoke all on function private.tell_reply_parent_visible(uuid,uuid) from public, anon;
grant execute on function private.tell_reply_parent_visible(uuid,uuid) to authenticated;
alter policy comments_add on public.tell_comments with check (
  (select private.tells_member()) and user_id = (select auth.uid())
  and (reply_to is null or private.tell_reply_parent_visible(reply_to,tell_id))
);
