-- School Center AI cloud history + media storage
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'school-center-default',
  title text not null default 'School Center AI',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at);

-- Keep conversation timestamps fresh when messages are added.
create or replace function public.touch_ai_conversation_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_conversations
    set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists ai_messages_touch_conversation on public.ai_messages;
create trigger ai_messages_touch_conversation
after insert on public.ai_messages
for each row execute function public.touch_ai_conversation_updated_at();

-- Enable Realtime for cross-device message updates. Ignore duplicate-object errors.
do $$
begin
  alter publication supabase_realtime add table public.ai_messages;
exception
  when duplicate_object then null;
end $$;

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy "Users can read their AI conversations"
  on public.ai_conversations for select
  using (auth.uid() = user_id);

create policy "Users can create their AI conversations"
  on public.ai_conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update their AI conversations"
  on public.ai_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read their AI messages"
  on public.ai_messages for select
  using (auth.uid() = user_id);

create policy "Users can create their AI messages"
  on public.ai_messages for insert
  with check (auth.uid() = user_id);

-- Private bucket for uploaded chat media.
insert into storage.buckets (id, name, public)
values ('ai-chat-media', 'ai-chat-media', false)
on conflict (id) do nothing;

create policy "Users can read their AI media"
  on storage.objects for select
  using (
    bucket_id = 'ai-chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload their AI media"
  on storage.objects for insert
  with check (
    bucket_id = 'ai-chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their AI media"
  on storage.objects for delete
  using (
    bucket_id = 'ai-chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
