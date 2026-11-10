-- Run once in a NEW Supabase project's SQL Editor.
begin;
create table public.bookings (
 id uuid primary key,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 revision integer not null default 1 check(revision>0),
 name text not null check(length(trim(name)) between 1 and 160),
 destination text not null check(length(trim(destination)) between 1 and 120),
 trip text not null default '' check(length(trip)<=100),
 platform text not null check(platform in ('Agoda','Airbnb','Booking.com','Direct','Other')),
 reference text not null default '' check(length(reference)<=100),
 "checkIn" date not null, "checkOut" date not null,
 currency text not null check(currency in ('SGD','JPY','USD','EUR','GBP','AUD','MYR','THB','CNY','KRW','HKD')),
 total numeric not null check(total>=0 and total<=1000000000),
 paid numeric not null check(paid>=0 and paid<=total),
 policy text not null check(policy in ('free','nonrefundable','unknown')),
 "cancellationAt" timestamptz, "paymentAt" timestamptz,
 fee numeric check(fee>=0 and fee<=total),
 "offset" text not null check("offset" ~ '^[+-](0[0-9]|1[0-4]):[0-5][0-9]$'),
 state text not null check(state in ('active','cancelled','completed')),
 url text not null default '' check(length(url)<=2000 and (url='' or url ~* '^https?://[^[:space:]]+$')),
 notes text not null default '' check(length(notes)<=2000),
 updated_at timestamptz not null default now(),
 check("checkOut">"checkIn"), check(policy<>'free' or "cancellationAt" is not null)
);
create index bookings_user_id_idx on public.bookings(user_id);
alter table public.bookings enable row level security;
alter table public.bookings force row level security;
revoke all on public.bookings from anon;
revoke all on public.bookings from authenticated;
grant select,insert,update,delete on public.bookings to authenticated;
create policy "Read own bookings" on public.bookings for select to authenticated using ((select auth.uid())=user_id);
create policy "Create own bookings" on public.bookings for insert to authenticated with check ((select auth.uid())=user_id);
create policy "Update own bookings" on public.bookings for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy "Delete own bookings" on public.bookings for delete to authenticated using ((select auth.uid())=user_id);
create function public.stayola_booking_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.user_id<>old.user_id then raise exception 'Booking identity cannot change'; end if;
 if new.revision<>old.revision+1 then raise exception 'Invalid revision. Reload the booking.'; end if;
 new.updated_at=now(); return new;
end;
$$;
create trigger stayola_revision before update on public.bookings for each row execute function public.stayola_booking_revision();
commit;
