-- Live call captions: Twilio real-time transcription of the landlord call, one row per final utterance.
-- Written by the Twilio webhook and read by the call poll, both with the service role (no user access).
create table if not exists public.call_live (
  call_sid text not null,
  seq bigint not null,
  track text not null,
  text text not null,
  at timestamptz not null default now(),
  primary key (call_sid, track, seq)
);
alter table public.call_live enable row level security;
revoke all on public.call_live from anon, authenticated;
grant all on public.call_live to service_role;
