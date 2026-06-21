-- Trigger: auth.users'a yeni satır eklenince profiles'a otomatik ekle
-- username, signUp sırasında raw_user_meta_data'ya gömülür
-- search_path boş bırakılmalı (Supabase güvenlik standardı)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Fonksiyonu çağırabilecek roller
grant execute on function public.handle_new_user() to postgres, service_role;

-- Eski trigger varsa temizle
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Mevcut kullanıcılara profil yoksa oluştur (backfill)
insert into public.profiles (id, username)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
