alter table public.matches
  add column if not exists current_minute int not null default 0;