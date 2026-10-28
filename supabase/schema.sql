-- StayManager database. Paste this whole file into Supabase -> SQL Editor -> Run.

create extension if not exists pgcrypto;

-- ───────────── Tables ─────────────
create table if not exists public.properties (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  room_no     text not null,
  floor       int  not null default 1,
  price       int  not null default 0,          -- rent per bed per month (₹)
  created_at  timestamptz not null default now()
);

create table if not exists public.beds (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  label       text not null,
  occupied    boolean not null default false
);

create table if not exists public.complaints (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_name text not null,
  message     text not null,
  category    text not null default 'General',
  priority    text not null default 'low'       check (priority in ('low','medium','high')),
  kind        text not null default 'complaint' check (kind in ('request','query','complaint')),
  status      text not null default 'open'      check (status in ('open','in_progress','resolved')),
  created_at  timestamptz not null default now()
);

create table if not exists public.calls (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid not null references public.properties(id) on delete cascade,
  caller_name      text not null default 'Unknown caller',
  summary          text not null default '',
  intent           text not null default 'other'
                   check (intent in ('bed_vacancy','room_vacancy','price_query','complaint','request','other')),
  sentiment        text not null default 'green' check (sentiment in ('green','orange','red')),
  duration_seconds int  not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  bed_id      uuid references public.beds(id) on delete set null,   -- null once the tenant has moved out
  name        text not null,
  phone       text not null default '',
  whatsapp    text not null default '',
  email       text not null default '',
  rent_amount int  not null default 0,                              -- rent per month (₹)
  deposit     int  not null default 0,
  move_in     date not null default current_date,
  move_out    date,
  due_day     int  not null default 5 check (due_day between 1 and 28),
  notes       text not null default '',
  id_type     text not null default '',                             -- Aadhaar, PAN, ...
  id_last4    text not null default '',                             -- last 4 digits only, never the full number
  id_doc_paths text[] not null default '{}',                        -- files in the private tenant-docs bucket
  status      text not null default 'active' check (status in ('active','left')),
  created_at  timestamptz not null default now()
);

-- For databases created before ID proof existed
alter table public.tenants
  add column if not exists id_type text not null default '',
  add column if not exists id_last4 text not null default '',
  add column if not exists id_doc_paths text[] not null default '{}';

create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  amount      int  not null check (amount > 0),
  paid_on     date not null default current_date,
  for_month   text not null,                                        -- 'YYYY-MM'
  method      text not null default 'UPI',
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists rooms_property_idx      on public.rooms(property_id);
create index if not exists beds_room_idx           on public.beds(room_id);
create index if not exists complaints_property_idx on public.complaints(property_id, created_at desc);
create index if not exists calls_property_idx      on public.calls(property_id, created_at desc);
create index if not exists tenants_property_idx    on public.tenants(property_id);
create index if not exists tenants_bed_idx         on public.tenants(bed_id);
create index if not exists payments_tenant_idx     on public.payments(tenant_id, paid_on desc);

-- ───────────── Security (Row Level Security) ─────────────
-- Each owner can only see and change their own PGs.
create or replace function public.owns_property(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.properties p where p.id = pid and p.owner_id = auth.uid());
$$;

create or replace function public.owns_room(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.rooms r
    join public.properties p on p.id = r.property_id
    where r.id = rid and p.owner_id = auth.uid()
  );
$$;

alter table public.properties enable row level security;
alter table public.rooms      enable row level security;
alter table public.beds       enable row level security;
alter table public.complaints enable row level security;
alter table public.calls      enable row level security;
alter table public.tenants    enable row level security;
alter table public.payments   enable row level security;

drop policy if exists "own properties" on public.properties;
create policy "own properties" on public.properties for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "own rooms" on public.rooms;
create policy "own rooms" on public.rooms for all
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

drop policy if exists "own beds" on public.beds;
create policy "own beds" on public.beds for all
  using (public.owns_room(room_id)) with check (public.owns_room(room_id));

drop policy if exists "own complaints" on public.complaints;
create policy "own complaints" on public.complaints for all
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

drop policy if exists "own calls" on public.calls;
create policy "own calls" on public.calls for all
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

drop policy if exists "own tenants" on public.tenants;
create policy "own tenants" on public.tenants for all
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for all
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

-- ───────────── ID proof storage (PRIVATE bucket; each owner sees only their own folder) ─────────────
insert into storage.buckets (id, name, public)
values ('tenant-docs', 'tenant-docs', false)
on conflict (id) do nothing;

drop policy if exists "owner read docs" on storage.objects;
create policy "owner read docs" on storage.objects for select to authenticated
  using (bucket_id = 'tenant-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owner upload docs" on storage.objects;
create policy "owner upload docs" on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "owner delete docs" on storage.objects;
create policy "owner delete docs" on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-docs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ───────────── Realtime (new calls/complaints appear instantly in the app) ─────────────
do $$ begin
  alter publication supabase_realtime add table public.calls;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.complaints;
exception when duplicate_object then null; end $$;

-- ───────────── Sample data button ("Load sample data instead") ─────────────
create or replace function public.seed_demo() returns uuid
language plpgsql as $$
declare
  pid uuid; rid uuid; bid uuid; tid uuid; spec jsonb; r jsonb; flag text; i int; n int := 0;
  names text[] := array['Ramesh Kumar','Sunil Reddy','Arjun Mehta','Vikram S.','Neha Gupta','Karthik R.','Faisal Khan','Anita Joshi'];
begin
  insert into public.properties(name) values ('Green Nest PG') returning id into pid;

  spec := '[
    {"no":"101","floor":1,"price":8000,"beds":[false,true]},
    {"no":"102","floor":1,"price":6500,"beds":[true,true,false]},
    {"no":"103","floor":1,"price":9500,"beds":[true]},
    {"no":"201","floor":2,"price":6000,"beds":[true,false,false]},
    {"no":"202","floor":2,"price":7500,"beds":[false,true]},
    {"no":"203","floor":2,"price":5500,"beds":[true,false,true,false]}
  ]'::jsonb;

  for r in select * from jsonb_array_elements(spec) loop
    insert into public.rooms(property_id, room_no, floor, price)
    values (pid, r->>'no', (r->>'floor')::int, (r->>'price')::int) returning id into rid;
    i := 0;
    for flag in select jsonb_array_elements_text(r->'beds') loop
      i := i + 1;
      insert into public.beds(room_id, label, occupied) values (rid, 'Bed ' || i, flag::boolean) returning id into bid;
      if flag::boolean then
        n := n + 1;
        insert into public.tenants(property_id, bed_id, name, phone, whatsapp, rent_amount, deposit, move_in, due_day)
        values (pid, bid, names[n], '98765400' || (10 + n), '98765400' || (10 + n),
                (r->>'price')::int, (r->>'price')::int * 2,
                (date_trunc('month', now()) - interval '2 months')::date + 2, 5)
        returning id into tid;
        -- two past months paid in full
        insert into public.payments(property_id, tenant_id, amount, paid_on, for_month, method)
        select pid, tid, (r->>'price')::int, m::date + 4, to_char(m, 'YYYY-MM'), 'UPI'
        from generate_series(date_trunc('month', now()) - interval '2 months',
                             date_trunc('month', now()) - interval '1 month', interval '1 month') m;
        -- every second tenant has paid this month too
        if n % 2 = 0 then
          insert into public.payments(property_id, tenant_id, amount, paid_on, for_month, method)
          values (pid, tid, (r->>'price')::int, current_date, to_char(now(), 'YYYY-MM'), 'Cash');
        end if;
      end if;
    end loop;
  end loop;

  insert into public.complaints(property_id, tenant_name, message, category, priority, kind, status, created_at) values
    (pid,'Rajiv M.','Hot water is not available in the morning. Please check the geyser.','Maintenance','high','complaint','open', now() - interval '20 hours'),
    (pid,'Rohit Verma','Request deep cleaning of bathroom in room 102.','Cleaning','medium','request','in_progress', now() - interval '22 hours'),
    (pid,'Megha R.','Can I get a monthly discount for 6-month advance payment?','Pricing','low','query','in_progress', now() - interval '23 hours'),
    (pid,'Nandini P.','Please install a water purifier on 2nd floor.','Amenities','low','request','in_progress', now() - interval '24 hours');

  insert into public.calls(property_id, caller_name, summary, intent, sentiment, duration_seconds, created_at) values
    (pid,'Amit Kumar','Caller asked about bed availability for a working professional. Prefers AC room.','bed_vacancy','green',142, now() - interval '20 minutes'),
    (pid,'Sneha D.','Wanted price list for triple sharing. Mentioned budget around ₹7000.','price_query','orange',95, now() - interval '3 hours'),
    (pid,'Rajiv M.','Existing tenant complained about hot water issue in morning.','complaint','red',218, now() - interval '21 hours'),
    (pid,'Kavya S.','Looking for single-sharing room for 3 months. Will visit this weekend.','room_vacancy','green',110, now() - interval '25 hours'),
    (pid,'Rahul A.','Asked if any bed is free on the first floor. Wants to move in next week.','bed_vacancy','green',75, now() - interval '28 hours'),
    (pid,'Priya N.','Asked about monthly rent for double sharing and the security deposit.','price_query','orange',88, now() - interval '33 hours'),
    (pid,'Tenant 203','Wifi is slow in the evenings. Requested a router check.','complaint','orange',130, now() - interval '47 hours'),
    (pid,'Imran S.','Requested an extra cupboard in his room.','request','green',64, now() - interval '52 hours');

  return pid;
end $$;

-- ───────────── Feedback to the app author ─────────────
-- Owners can send feedback and read back their own; you (the author) read all of it in Table Editor > feedback.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_email text,
  kind text not null default 'idea' check (kind in ('bug','idea','praise','other')),
  message text not null check (char_length(message) between 3 and 2000),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "send feedback" on public.feedback;
create policy "send feedback" on public.feedback for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback for select to authenticated using (user_id = auth.uid());

-- ───────────── Leaving dates, vacant-since dates, voice-agent hook ─────────────
alter table public.tenants add column if not exists leaving_on date;      -- date the tenant said they will leave
alter table public.beds    add column if not exists vacant_since date;    -- when the bed became vacant

do $$ begin
  alter publication supabase_realtime add table public.tenants;
exception when duplicate_object then null; end $$;

-- Your AI voice agent calls this (with the service_role key) when a tenant says they are leaving.
-- It saves the leaving date on the tenant AND creates an Inbox request so you get notified.
create or replace function public.report_leaving(p_phone text, p_date date, p_property uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare t public.tenants%rowtype;
begin
  select * into t from public.tenants
   where status = 'active'
     and right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
     and (p_property is null or property_id = p_property)
   order by created_at desc limit 1;
  if not found then return null; end if;
  update public.tenants set leaving_on = p_date where id = t.id;
  insert into public.complaints(property_id, tenant_name, message, category, priority, kind, status)
  values (t.property_id, t.name, t.name || ' plans to leave on ' || to_char(p_date, 'DD Mon YYYY') || '.', 'Vacating', 'medium', 'request', 'open');
  return t.name;
end $$;
revoke all on function public.report_leaving(text, date, uuid) from public, anon, authenticated;
grant execute on function public.report_leaving(text, date, uuid) to service_role;

-- ───────────── Payment screenshots (receipts) ─────────────
alter table public.payments add column if not exists proof_path text;     -- file in the private tenant-docs bucket

-- ───────────── Attenders (staff): complaints + tenant contacts only ─────────────
-- (Already applied to the live database. Kept here so a fresh database gets it too.)
create table if not exists public.property_staff (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  email       text not null,
  name        text not null default '',
  created_at  timestamptz not null default now()
);
create unique index if not exists property_staff_uniq on public.property_staff(property_id, lower(email));
alter table public.property_staff enable row level security;
drop policy if exists "owner manages staff" on public.property_staff;
create policy "owner manages staff" on public.property_staff for all to authenticated
  using (public.owns_property(property_id)) with check (public.owns_property(property_id));

create or replace function public.is_staff_of(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.property_staff s
    where s.property_id = pid and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.properties where owner_id = auth.uid()) then 'owner'
    when exists (select 1 from public.property_staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) then 'staff'
    else 'owner'
  end;
$$;

create or replace function public.staff_load() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select distinct p.id, p.name
    from public.properties p
    join public.property_staff s on s.property_id = p.id
    where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  select jsonb_build_object(
    'properties', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name) from mine m), '[]'::jsonb),
    'complaints', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (
        select id, property_id, tenant_name, message, category, priority, kind, status, created_at, caller_phone
        from public.complaints
        where property_id in (select id from mine)
        order by created_at desc limit 300
      ) c), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.room_no, x.name) from (
        select t.id, t.property_id, t.name, t.phone, t.whatsapp, r.room_no, b.label as bed_label
        from public.tenants t
        join public.beds b on b.id = t.bed_id
        join public.rooms r on r.id = b.room_id
        where t.status = 'active' and t.property_id in (select id from mine)
      ) x), '[]'::jsonb)
  );
$$;

create or replace function public.staff_set_complaint_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('open', 'in_progress', 'resolved') then raise exception 'Invalid status'; end if;
  update public.complaints c set status = p_status
   where c.id = p_id and public.is_staff_of(c.property_id);
  if not found then raise exception 'Not allowed'; end if;
end $$;

revoke all on function public.is_staff_of(uuid) from public, anon, authenticated;
revoke all on function public.my_role() from public, anon;
revoke all on function public.staff_load() from public, anon;
revoke all on function public.staff_set_complaint_status(uuid, text) from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.staff_load() to authenticated;
grant execute on function public.staff_set_complaint_status(uuid, text) to authenticated;
