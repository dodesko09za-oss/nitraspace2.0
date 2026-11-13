-- Registered-user global chat. Messages are readable/writable only by
-- authenticated users; the existing private and anonymous chat tables stay untouched.
create table if not exists public.global_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint global_chat_body_length check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists global_chat_messages_created_idx
  on public.global_chat_messages(created_at desc);

alter table public.global_chat_messages enable row level security;

drop policy if exists global_chat_select_authenticated on public.global_chat_messages;
create policy global_chat_select_authenticated
  on public.global_chat_messages for select to authenticated
  using (true);

drop policy if exists global_chat_insert_authenticated on public.global_chat_messages;
create policy global_chat_insert_authenticated
  on public.global_chat_messages for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists global_chat_delete_own on public.global_chat_messages;
create policy global_chat_delete_own
  on public.global_chat_messages for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.global_chat_messages to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'global_chat_messages'
     ) then
    alter publication supabase_realtime add table public.global_chat_messages;
  end if;
end $$;
