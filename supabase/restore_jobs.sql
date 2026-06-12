create table if not exists public.restore_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique default gen_random_uuid(),
  code text not null,
  style text not null,
  request_id uuid not null,
  provider_task_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'expired')),
  model text not null,
  original_file_name text,
  result_image_url text,
  result_storage_path text,
  result_mime_type text,
  user_id uuid,
  access_mode text not null default 'card-key'
    check (access_mode in ('card-key', 'session')),
  credit_reserved boolean not null default false,
  credit_consumed boolean not null default false,
  credit_released boolean not null default false,
  credit_source text
    check (credit_source is null or credit_source in ('monthly', 'credit_balance', 'card_key')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.restore_jobs
  add column if not exists job_id uuid not null default gen_random_uuid();

alter table public.restore_jobs
  add column if not exists request_id uuid;

alter table public.restore_jobs
  add column if not exists provider_task_id text;

alter table public.restore_jobs
  add column if not exists status text not null default 'queued';

alter table public.restore_jobs
  add column if not exists model text not null default 'gpt-image-2';

alter table public.restore_jobs
  add column if not exists original_file_name text;

alter table public.restore_jobs
  add column if not exists result_image_url text;

alter table public.restore_jobs
  add column if not exists result_storage_path text;

alter table public.restore_jobs
  add column if not exists result_mime_type text;

alter table public.restore_jobs
  add column if not exists user_id uuid;

alter table public.restore_jobs
  add column if not exists access_mode text not null default 'card-key';

alter table public.restore_jobs
  add column if not exists credit_reserved boolean not null default false;

alter table public.restore_jobs
  add column if not exists credit_consumed boolean not null default false;

alter table public.restore_jobs
  add column if not exists credit_released boolean not null default false;

alter table public.restore_jobs
  add column if not exists credit_source text;

alter table public.restore_jobs
  add column if not exists error_message text;

alter table public.restore_jobs
  add column if not exists completed_at timestamptz;

create unique index if not exists restore_jobs_job_id_idx
on public.restore_jobs (job_id);

create unique index if not exists restore_jobs_provider_task_id_idx
on public.restore_jobs (provider_task_id);

create index if not exists restore_jobs_active_code_style_idx
on public.restore_jobs (code, style, status, created_at desc)
where status in ('queued', 'processing');

create index if not exists restore_jobs_created_at_idx
on public.restore_jobs (created_at desc);

create or replace function public.set_restore_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restore_jobs_set_updated_at on public.restore_jobs;

create trigger restore_jobs_set_updated_at
before update on public.restore_jobs
for each row
execute function public.set_restore_jobs_updated_at();

alter table public.restore_jobs enable row level security;

drop policy if exists "service role can manage restore_jobs" on public.restore_jobs;

create policy "service role can manage restore_jobs"
on public.restore_jobs
for all
to service_role
using (true)
with check (true);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'restore-results',
  'restore-results',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "service role can manage restore results" on storage.objects;

create policy "service role can manage restore results"
on storage.objects
for all
to service_role
using (bucket_id = 'restore-results')
with check (bucket_id = 'restore-results');
