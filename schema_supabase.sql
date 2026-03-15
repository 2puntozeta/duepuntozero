create extension if not exists pgcrypto;

create table if not exists public.daily_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, data)
);

create table if not exists public.cash_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('contanti','pos','allianz','postepay')),
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, kind)
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  cassa text not null check (cassa in ('contanti','pos','allianz','postepay')),
  tipo text not null check (tipo in ('entrata','uscita')),
  importo numeric(12,2) not null check (importo >= 0),
  descrizione text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  aliases text[] not null default '{}',
  sospeso_iniziale numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);

create table if not exists public.supplier_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('fattura','pagamento')),
  importo numeric(12,2) not null check (importo >= 0),
  nota text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  ruolo text default '',
  dovuto_mensile numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);

create table if not exists public.employee_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('pagamento','extra','acconto')),
  importo numeric(12,2) not null check (importo >= 0),
  nota text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  nome text not null,
  adulti integer not null default 0,
  bambini integer not null default 0,
  tipo text not null check (tipo in ('ristorante','pizzeria','menu_fisso','giro_pizza','banchetto')),
  importo numeric(12,2) not null default 0,
  ora text default '',
  note text default '',
  created_at timestamptz not null default now()
);

create or replace function public.set_user_id()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_user_id_daily_records on public.daily_records;
create trigger trg_set_user_id_daily_records before insert on public.daily_records
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_cash_state on public.cash_state;
create trigger trg_set_user_id_cash_state before insert on public.cash_state
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_cash_movements on public.cash_movements;
create trigger trg_set_user_id_cash_movements before insert on public.cash_movements
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_suppliers on public.suppliers;
create trigger trg_set_user_id_suppliers before insert on public.suppliers
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_supplier_movements on public.supplier_movements;
create trigger trg_set_user_id_supplier_movements before insert on public.supplier_movements
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_employees on public.employees;
create trigger trg_set_user_id_employees before insert on public.employees
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_employee_movements on public.employee_movements;
create trigger trg_set_user_id_employee_movements before insert on public.employee_movements
for each row execute function public.set_user_id();

drop trigger if exists trg_set_user_id_bookings on public.bookings;
create trigger trg_set_user_id_bookings before insert on public.bookings
for each row execute function public.set_user_id();

alter table public.daily_records enable row level security;
alter table public.cash_state enable row level security;
alter table public.cash_movements enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_movements enable row level security;
alter table public.employees enable row level security;
alter table public.employee_movements enable row level security;
alter table public.bookings enable row level security;

drop policy if exists p_daily_records_all on public.daily_records;
create policy p_daily_records_all on public.daily_records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_cash_state_all on public.cash_state;
create policy p_cash_state_all on public.cash_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_cash_movements_all on public.cash_movements;
create policy p_cash_movements_all on public.cash_movements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_suppliers_all on public.suppliers;
create policy p_suppliers_all on public.suppliers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_supplier_movements_all on public.supplier_movements;
create policy p_supplier_movements_all on public.supplier_movements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_employees_all on public.employees;
create policy p_employees_all on public.employees for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_employee_movements_all on public.employee_movements;
create policy p_employee_movements_all on public.employee_movements for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists p_bookings_all on public.bookings;
create policy p_bookings_all on public.bookings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);