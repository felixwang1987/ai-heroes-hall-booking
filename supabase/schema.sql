-- AI 英雄汇：一间会议室。首次部署时在 Supabase SQL Editor 执行一次。
-- 日期和时间以 timestamptz (UTC) 存储；预约规则按重庆 Asia/Shanghai 本地时间校验。

create table public.app_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('booker', 'display'))
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  booker text not null check (length(btrim(booker)) between 1 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  remark text not null default '' check (length(remark) <= 2000),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint booking_positive_duration check (ends_at > starts_at),
  constraint booking_same_local_day check (
    (starts_at at time zone 'Asia/Shanghai')::date =
    (ends_at at time zone 'Asia/Shanghai')::date
  ),
  constraint booking_half_hour_slots check (
    extract(minute from starts_at at time zone 'Asia/Shanghai') in (0, 30)
    and extract(second from starts_at at time zone 'Asia/Shanghai') = 0
    and extract(minute from ends_at at time zone 'Asia/Shanghai') in (0, 30)
    and extract(second from ends_at at time zone 'Asia/Shanghai') = 0
  ),
  constraint booking_open_hours check (
    (starts_at at time zone 'Asia/Shanghai')::time >= time '08:00'
    and (ends_at at time zone 'Asia/Shanghai')::time <= time '17:00'
  ),
  constraint booking_lunch_break check (
    (ends_at at time zone 'Asia/Shanghai')::time <= time '12:00'
    or (starts_at at time zone 'Asia/Shanghai')::time >= time '13:00'
  ),
  -- [) makes adjacent bookings valid: 09:00–09:30 and 09:30–10:00.
  constraint booking_no_overlap exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);

create index bookings_starts_at_idx on public.bookings (starts_at)
  where status = 'confirmed';

create function public.touch_booking_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bookings_touch_updated_at
before update on public.bookings
for each row execute function public.touch_booking_updated_at();

alter table public.app_roles enable row level security;
alter table public.bookings enable row level security;

-- Each authenticated user can inspect only its own assigned role.
create policy app_roles_read_self on public.app_roles
  for select to authenticated
  using (user_id = auth.uid());

-- Both accounts can view bookings. Only the shared booker account can change them.
create policy bookings_read on public.bookings
  for select to authenticated
  using (exists (
    select 1 from public.app_roles r
    where r.user_id = auth.uid() and r.role in ('booker', 'display')
  ));

create policy bookings_insert_booker on public.bookings
  for insert to authenticated
  with check (exists (
    select 1 from public.app_roles r
    where r.user_id = auth.uid() and r.role = 'booker'
  ));

create policy bookings_update_booker on public.bookings
  for update to authenticated
  using (
    status = 'confirmed'
    and exists (
      select 1 from public.app_roles r
      where r.user_id = auth.uid() and r.role = 'booker'
    )
  )
  with check (exists (
    select 1 from public.app_roles r
    where r.user_id = auth.uid() and r.role = 'booker'
  ));

-- No DELETE policy: cancellation changes status, preserving a simple audit trail.
revoke all on public.app_roles from anon, authenticated;
revoke all on public.bookings from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.app_roles to authenticated;
grant select on public.bookings to authenticated;
grant insert (title, booker, starts_at, ends_at, remark) on public.bookings
  to authenticated;
grant update (title, booker, starts_at, ends_at, remark, status) on public.bookings
  to authenticated;

-- Administrator setup, after creating two email/password users in Supabase Auth:
-- 1. Find their UUIDs with:
--    select id, email from auth.users where email in ('BOOKER_EMAIL', 'DISPLAY_EMAIL');
-- 2. Replace UUID placeholders and run from SQL Editor (never from the browser):
--    insert into public.app_roles (user_id, role) values
--      ('BOOKER_USER_UUID', 'booker'),
--      ('DISPLAY_USER_UUID', 'display');
-- 3. Enter the project URL, publishable key and those two emails in src/config.js.
--    Do not put either password or a service-role/secret key in public source.
