-- The dedicated password-panel identity must still be an active admin.
create or replace function private.tells_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not private.account_is_banned(auth.uid())
    and (
      (coalesce(auth.jwt()->'app_metadata'->>'auth_provider', '') = 'clerk'
       and coalesce(auth.jwt()->'app_metadata'->>'clerk_user_id', '') <> '')
      or (auth.uid() = '56403701-f7af-46e8-bf02-b1ec31235800'::uuid and private.is_admin(auth.uid()))
    )
$$;
