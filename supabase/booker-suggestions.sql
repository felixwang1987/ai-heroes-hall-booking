-- Run once in the Supabase SQL Editor after schema.sql.
-- Keep names out of this public repository: insert them in the private SQL Editor.

create table public.booker_suggestions (
  name text primary key check (length(btrim(name)) between 1 and 80),
  sort_order integer not null unique check (sort_order > 0)
);

alter table public.booker_suggestions enable row level security;

-- Only the signed-in department booking account can read suggestions.
create policy booker_suggestions_read_booker on public.booker_suggestions
  for select to authenticated
  using (exists (
    select 1 from public.app_roles r
    where r.user_id = auth.uid() and r.role = 'booker'
  ));

revoke all on public.booker_suggestions from anon, authenticated;
grant select on public.booker_suggestions to authenticated;
