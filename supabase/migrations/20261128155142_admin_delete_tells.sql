grant delete on public.unreleased_tells to authenticated;

create policy tells_remove on public.unreleased_tells for delete to authenticated
using ((select private.tells_member()) and (select public.is_admin()));

create function public.delete_all_tells()
returns text[]
language plpgsql
security invoker
set search_path = ''
as $function$
declare paths text[];
begin
  if not (private.tells_member() and public.is_admin()) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  with deleted as (delete from public.unreleased_tells returning photo_path)
  select coalesce(array_agg(photo_path), array[]::text[]) into paths from deleted;
  return paths;
end;
$function$;
revoke all on function public.delete_all_tells() from public, anon;
grant execute on function public.delete_all_tells() to authenticated;
