-- Keep users' ability to remove their own messages and let trusted admins
-- moderate any global chat message through the existing private admin list.
drop policy if exists global_chat_delete_own on public.global_chat_messages;
drop policy if exists global_chat_delete_admin_or_own on public.global_chat_messages;

create policy global_chat_delete_admin_or_own
  on public.global_chat_messages for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or (select private.is_admin((select auth.uid())))
  );
