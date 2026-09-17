-- ============================================================================
-- 002_user_notes_assignments.sql
-- Real cross-device sync for Notes and Assignments (previously localStorage-only)
-- Run this once in the Supabase SQL Editor, same as 001_initial_schema.sql.
-- Uses the same auth.users identity as the existing AI-history magic-link sign-in
-- (Settings -> AI history account), so no separate login system is needed.
-- ============================================================================

create extension if not exists pgcrypto;

-- One row per note per user. `note_id` is the app's own local id
-- (e.g. "note_1699999999"), `data` is the full note object as JSON so the
-- schema doesn't need to change every time the note shape grows.
create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, note_id)
);

create table if not exists public.user_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, assignment_id)
);

alter table public.user_notes add column if not exists deleted_at timestamptz null;
alter table public.user_assignments add column if not exists deleted_at timestamptz null;

create index if not exists user_notes_user_idx on public.user_notes(user_id);
create index if not exists user_assignments_user_idx on public.user_assignments(user_id);

alter table public.user_notes enable row level security;
alter table public.user_assignments enable row level security;

drop policy if exists "Users can read their notes" on public.user_notes;
create policy "Users can read their notes"
  on public.user_notes for select
  using (auth.uid() = user_id);

drop policy if exists "Users can write their notes" on public.user_notes;
create policy "Users can write their notes"
  on public.user_notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their notes" on public.user_notes;
create policy "Users can update their notes"
  on public.user_notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their notes" on public.user_notes;
create policy "Users can delete their notes"
  on public.user_notes for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can read their assignments" on public.user_assignments;
create policy "Users can read their assignments"
  on public.user_assignments for select
  using (auth.uid() = user_id);

drop policy if exists "Users can write their assignments" on public.user_assignments;
create policy "Users can write their assignments"
  on public.user_assignments for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their assignments" on public.user_assignments;
create policy "Users can update their assignments"
  on public.user_assignments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their assignments" on public.user_assignments;
create policy "Users can delete their assignments"
  on public.user_assignments for delete
  using (auth.uid() = user_id);

-- Optional but recommended: realtime so a change on one device shows up on
-- another without waiting for a manual "Sync now".
do $$
begin
  alter publication supabase_realtime add table public.user_notes;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.user_assignments;
exception
  when duplicate_object then null;
end $$;
