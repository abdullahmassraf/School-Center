-- 006_deadlines.sql
-- Cross-device deadlines and assessments for the academic dashboard.

create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deadline_id text not null,
  course_id text not null,
  title text not null,
  type text not null default 'other' check (type in ('exam', 'quiz', 'lab', 'assignment', 'other')),
  due_at timestamptz not null,
  weight numeric,
  status text not null default 'upcoming' check (status in ('upcoming', 'done', 'missed')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  unique (user_id, deadline_id)
);

create index if not exists deadlines_user_due_idx on public.deadlines(user_id, due_at);
create index if not exists deadlines_course_due_idx on public.deadlines(user_id, course_id, due_at);

alter table public.deadlines enable row level security;

drop policy if exists "Users can read their deadlines" on public.deadlines;
create policy "Users can read their deadlines" on public.deadlines for select using (auth.uid() = user_id);

drop policy if exists "Users can create their deadlines" on public.deadlines;
create policy "Users can create their deadlines" on public.deadlines for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their deadlines" on public.deadlines;
create policy "Users can update their deadlines" on public.deadlines for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their deadlines" on public.deadlines;
create policy "Users can delete their deadlines" on public.deadlines for delete using (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.deadlines;
exception when duplicate_object then null;
end $$;
