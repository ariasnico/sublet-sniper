-- Multi-tenant Sublet Sniper: one session row per signed-in user (the whole app State as jsonb).
-- RLS: a user can only see and change their own row. Webhooks (AgentMail, ElevenLabs) use the service role.

create table if not exists public.sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.sessions enable row level security;

drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_insert_own" on public.sessions;
drop policy if exists "sessions_update_own" on public.sessions;
drop policy if exists "sessions_delete_own" on public.sessions;

create policy "sessions_select_own" on public.sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "sessions_insert_own" on public.sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "sessions_update_own" on public.sessions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sessions_delete_own" on public.sessions for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.sessions from anon;
grant select, insert, update, delete on public.sessions to authenticated;
grant all on public.sessions to service_role;

-- Routing indexes for inbound webhooks: which tenant owns an AgentMail thread / a phone call.
-- RLS on with no policies: only the service role (server-side webhooks) reads or writes them.
create table if not exists public.thread_index (
  agentmail_thread_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.call_index (
  conversation_id text primary key, -- ElevenLabs conversation id, or our call id (both are indexed)
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists thread_index_user_idx on public.thread_index (user_id);
create index if not exists call_index_user_idx on public.call_index (user_id);

alter table public.thread_index enable row level security;
alter table public.call_index enable row level security;
revoke all on public.thread_index from anon, authenticated;
revoke all on public.call_index from anon, authenticated;
grant all on public.thread_index to service_role;
grant all on public.call_index to service_role;
