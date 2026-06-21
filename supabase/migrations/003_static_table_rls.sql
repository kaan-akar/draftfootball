-- Allow unrestricted inserts on static lookup tables so seed script can run
-- with either service_role key or anon key.
-- (football_players and coaches are read-only for end users; no PII.)

alter table public.football_players disable row level security;
alter table public.coaches disable row level security;

-- If you prefer to keep RLS enabled, run this instead:
-- create policy "Anon insert" on public.football_players for insert with check (true);
-- create policy "Anon insert" on public.coaches for insert with check (true);
