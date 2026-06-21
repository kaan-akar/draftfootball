alter table public.matches
  add column if not exists simulation_source text
  check (simulation_source in ('llm', 'local'));