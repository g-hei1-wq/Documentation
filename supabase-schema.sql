create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table if not exists public.change_records (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 120),
  record_date date not null,
  priority text not null check (priority in ('Important', 'Middle', 'Recent')),
  description text not null check (
    char_length(btrim(description)) > 0
    and cardinality(regexp_split_to_array(btrim(description), '\s+')) <= 1000
  ),
  author_id uuid not null references public.profiles(id),
  author_name text not null check (char_length(author_name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.record_shares (
  record_id uuid not null references public.change_records(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (record_id, user_id)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.change_records(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  category text not null check (category in ('Drawing / Sketch', 'Photo')),
  file_size bigint not null check (file_size between 0 and 524288000),
  content_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);

create or replace function public.is_workspace_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.workspace_activation_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where role = 'admin'
  );
$$;

create or replace function public.bootstrap_first_admin(
  target_user_id uuid,
  target_email text,
  target_full_name text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform pg_advisory_xact_lock(14519021, 1);

  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Workspace activation has already been completed.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from auth.users
    where id = target_user_id and lower(email) = lower(target_email)
  ) then
    raise exception 'The activation account was not found.' using errcode = '22023';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (target_user_id, lower(target_email), target_full_name, 'admin');
end;
$$;

revoke all on function public.workspace_activation_available() from public;
grant execute on function public.workspace_activation_available() to anon, authenticated;
revoke all on function public.bootstrap_first_admin(uuid, text, text) from public;
grant execute on function public.bootstrap_first_admin(uuid, text, text) to service_role;

create or replace function public.can_view_record(target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.change_records r
    where r.id = target_record_id
      and (
        r.author_id = (select auth.uid())
        or public.is_workspace_admin()
        or exists (
          select 1 from public.record_shares s
          where s.record_id = r.id and s.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function public.can_upload_to_record(target_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.change_records r
    where r.id = target_record_id and r.author_id = (select auth.uid())
  );
$$;

create or replace function public.set_record_shares(target_record_id uuid, target_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  record_author_id uuid;
begin
  if not public.is_workspace_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select author_id into record_author_id
  from public.change_records
  where id = target_record_id;
  if record_author_id is null then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;

  delete from public.record_shares where record_id = target_record_id;
  insert into public.record_shares (record_id, user_id)
  select target_record_id, requested.user_id
  from unnest(coalesce(target_user_ids, '{}'::uuid[])) as requested(user_id)
  where requested.user_id <> record_author_id
    and exists (select 1 from public.profiles p where p.id = requested.user_id);
end;
$$;

revoke all on function public.set_record_shares(uuid, uuid[]) from public;
grant execute on function public.set_record_shares(uuid, uuid[]) to authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert on public.change_records to authenticated;
grant select, insert, delete on public.record_shares to authenticated;
grant select, insert, delete on public.attachments to authenticated;

alter table public.profiles enable row level security;
alter table public.change_records enable row level security;
alter table public.record_shares enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "Profiles visible to self and admins" on public.profiles;
create policy "Profiles visible to self and admins"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_workspace_admin());

drop policy if exists "Records visible to authorized users" on public.change_records;
create policy "Records visible to authorized users"
  on public.change_records for select to authenticated
  using (public.can_view_record(id));

drop policy if exists "Members create own records" on public.change_records;
create policy "Members create own records"
  on public.change_records for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "Users see own shares and admins see all shares" on public.record_shares;
create policy "Users see own shares and admins see all shares"
  on public.record_shares for select to authenticated
  using (user_id = (select auth.uid()) or public.is_workspace_admin());

drop policy if exists "Admins manage record shares" on public.record_shares;
create policy "Admins manage record shares"
  on public.record_shares for all to authenticated
  using (public.is_workspace_admin())
  with check (public.is_workspace_admin());

drop policy if exists "Attachments visible with parent record" on public.attachments;
create policy "Attachments visible with parent record"
  on public.attachments for select to authenticated
  using (public.can_view_record(record_id));

drop policy if exists "Authors add attachments to own records" on public.attachments;
create policy "Authors add attachments to own records"
  on public.attachments for insert to authenticated
  with check (public.can_upload_to_record(record_id));

drop policy if exists "Authors and admins remove attachments" on public.attachments;
create policy "Authors and admins remove attachments"
  on public.attachments for delete to authenticated
  using (public.can_upload_to_record(record_id) or public.is_workspace_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values ('record-files', 'record-files', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = 524288000;

drop policy if exists "Private files visible with parent record" on storage.objects;
create policy "Private files visible with parent record"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'record-files'
    and public.can_view_record(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "Authors upload files to own records" on storage.objects;
create policy "Authors upload files to own records"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'record-files'
    and public.can_upload_to_record(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "Authors and admins delete files" on storage.objects;
create policy "Authors and admins delete files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'record-files'
    and (
      public.can_upload_to_record(((storage.foldername(name))[1])::uuid)
      or public.is_workspace_admin()
    )
  );

-- After creating the first auth user, add its profile as an admin from the SQL editor:
-- insert into public.profiles (id, email, full_name, role)
-- select id, email, 'Workspace Administrator', 'admin'
-- from auth.users where lower(email) = lower('ADMIN_EMAIL');