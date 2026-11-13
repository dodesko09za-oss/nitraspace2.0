-- Event administration now relies on the authenticated Supabase admin role.
-- Keep the RPC signature stable for existing clients; p_password is ignored.
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
      id, organizer, title, performer, event_date, place, link, image_data
    ) values (
      coalesce(p_event_id, gen_random_uuid()),
      btrim(p_event->>'organizer'), btrim(p_event->>'title'),
      btrim(p_event->>'performer'), (p_event->>'event_date')::timestamptz,
      btrim(p_event->>'place'), coalesce(btrim(p_event->>'link'), ''),
      coalesce(p_event->>'image_data', '')
    )
    on conflict (id) do update set
      organizer=excluded.organizer, title=excluded.title,
      performer=excluded.performer, event_date=excluded.event_date,
      place=excluded.place, link=excluded.link, image_data=excluded.image_data,
      updated_at=now()
    returning * into result_row;
  elsif p_action = 'update' then
    if p_event_id is null then raise exception 'Chýba ID eventu.'; end if;
    update public.nitra_events set
      organizer=btrim(p_event->>'organizer'), title=btrim(p_event->>'title'),
      performer=btrim(p_event->>'performer'),
      event_date=(p_event->>'event_date')::timestamptz,
      place=btrim(p_event->>'place'), link=coalesce(btrim(p_event->>'link'),''),
      image_data=coalesce(p_event->>'image_data',''), updated_at=now()
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
