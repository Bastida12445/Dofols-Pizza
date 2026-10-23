-- Dofol's Freshly Baked Pizza ordering system
-- Run this entire file once in Supabase Dashboard > SQL Editor.
begin;
create extension if not exists pgcrypto;

create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'admin' check (role in ('admin', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 100),
  description text not null default '',
  image_url text,
  category text not null default 'Pizza',
  is_available boolean not null default true,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  size_name text not null check (length(trim(size_name)) between 1 and 40),
  price numeric(10,2) not null check (price >= 0),
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, size_name)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  tracking_token_hash text not null,
  customer_name text not null check (length(trim(customer_name)) between 2 and 120),
  customer_phone text not null check (length(trim(customer_phone)) between 7 and 30),
  order_type text not null check (order_type in ('pickup', 'delivery')),
  delivery_address text,
  delivery_latitude numeric(10,7),
  delivery_longitude numeric(10,7),
  delivery_distance_km numeric(8,2),
  notes text not null default '',
  subtotal numeric(10,2) not null check (subtotal >= 0),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  total_amount numeric(10,2) not null check (total_amount >= 0),
  order_status text not null default 'Pending' check (order_status in ('Pending','Confirmed','Preparing','Ready for Pickup','Out for Delivery','Completed','Cancelled')),
  payment_method text not null check (payment_method in ('cash_on_pickup','cash_on_delivery','gcash','maya')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((order_type = 'pickup' and delivery_address is null and delivery_latitude is null and delivery_longitude is null and delivery_distance_km is null) or (order_type = 'delivery' and length(trim(coalesce(delivery_address,''))) >= 8 and delivery_latitude is not null and delivery_latitude between -90 and 90 and delivery_longitude is not null and delivery_longitude between -180 and 180 and delivery_distance_km is not null and delivery_distance_km > 0)),
  check (total_amount = subtotal + delivery_fee)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  size_id uuid references public.product_sizes(id) on delete set null,
  product_name_snapshot text not null,
  size_name_snapshot text not null,
  unit_price_snapshot numeric(10,2) not null check (unit_price_snapshot >= 0),
  quantity integer not null check (quantity between 1 and 50),
  line_total numeric(10,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  payment_method text not null check (payment_method in ('cash_on_pickup','cash_on_delivery','gcash','maya')),
  amount numeric(10,2) not null check (amount >= 0),
  payment_status text not null default 'Pending' check (payment_status in ('Pending','Paid','Failed','Refunded')),
  reference_number text check (reference_number is null or length(reference_number) between 4 and 100),
  verified_by_admin_id uuid references public.admin_profiles(id) on delete set null,
  verified_at timestamptz,
  gateway_session_id text,
  gateway_checkout_url text,
  gateway_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_status_history (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  previous_status text check (previous_status is null or previous_status in ('Pending','Paid','Failed','Refunded')),
  new_status text not null check (new_status in ('Pending','Paid','Failed','Refunded')),
  changed_by_admin_id uuid references public.admin_profiles(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.business_settings (
  id boolean primary key default true check (id = true),
  business_name text not null default 'Dofol''s Freshly Baked Pizza',
  business_address text not null default 'Loreto, Agusan del Sur, Philippines',
  business_phone text not null default '',
  business_hours text not null default '',
  pickup_enabled boolean not null default true,
  delivery_enabled boolean not null default false,
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  business_latitude numeric(10,7) check (business_latitude between -90 and 90),
  business_longitude numeric(10,7) check (business_longitude between -180 and 180),
  delivery_base_fee numeric(10,2) not null default 0 check (delivery_base_fee >= 0),
  delivery_fee_per_km numeric(10,2) not null default 0 check (delivery_fee_per_km >= 0),
  delivery_max_distance_km numeric(8,2) not null default 0 check (delivery_max_distance_km >= 0),
  gcash_enabled boolean not null default false,
  gcash_instructions text not null default '',
  maya_enabled boolean not null default false,
  maya_instructions text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.business_settings(id) values (true) on conflict (id) do nothing;

create index if not exists products_available_idx on public.products(is_available) where is_archived = false;
create index if not exists product_sizes_product_idx on public.product_sizes(product_id);
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists orders_status_idx on public.orders(order_status);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists payments_status_idx on public.payments(payment_status);
create index if not exists payment_history_payment_idx on public.payment_status_history(payment_id, created_at desc);
create unique index if not exists payments_gateway_session_uidx on public.payments(gateway_session_id) where gateway_session_id is not null;

-- All browser and database access goes through the Express API. The browser's
-- publishable key is used only for Supabase Auth; it has no table privileges.
alter table public.admin_profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_sizes enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_status_history enable row level security;
alter table public.business_settings enable row level security;
revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

drop function if exists public.create_order_atomic(text,text,text,text,text,text,text,text,jsonb);
create or replace function public.create_order_atomic(
  p_customer_name text,
  p_customer_phone text,
  p_order_type text,
  p_delivery_address text,
  p_notes text,
  p_payment_method text,
  p_reference_number text,
  p_tracking_token_hash text,
  p_items jsonb,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric,
  p_delivery_distance_km numeric,
  p_delivery_fee numeric
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_settings public.business_settings%rowtype;
  v_expected_delivery_fee numeric(10,2);
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_delivery_fee numeric(10,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_size public.product_sizes%rowtype;
  v_quantity integer;
begin
  if length(trim(coalesce(p_customer_name,''))) not between 2 and 120
     or length(trim(coalesce(p_customer_phone,''))) not between 7 and 30 then
    raise exception using errcode='22023', message='Please enter a valid name and mobile number';
  end if;
  if p_order_type not in ('pickup','delivery') or p_payment_method not in ('cash_on_pickup','cash_on_delivery','gcash','maya') then
    raise exception using errcode='22023', message='Invalid order or payment option';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode='22023', message='Cart must contain between 1 and 30 items';
  end if;
  if p_tracking_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023', message='Invalid tracking credential';
  end if;
  select * into strict v_settings from public.business_settings where id=true;
  if p_order_type='pickup' and not v_settings.pickup_enabled then
    raise exception using errcode='22023', message='Pickup is currently unavailable';
  elsif p_order_type='delivery' then
    if not v_settings.delivery_enabled then raise exception using errcode='22023', message='Delivery is currently unavailable'; end if;
    if length(trim(coalesce(p_delivery_address,''))) < 8 then raise exception using errcode='22023', message='A complete delivery address is required'; end if;
    if v_settings.business_latitude is null or v_settings.business_longitude is null or v_settings.delivery_max_distance_km <= 0 then raise exception using errcode='22023', message='Delivery distance pricing is not configured'; end if;
    if p_delivery_latitude is null or p_delivery_longitude is null or p_delivery_latitude not between -90 and 90 or p_delivery_longitude not between -180 and 180 then raise exception using errcode='22023', message='A valid delivery location is required'; end if;
    if p_delivery_distance_km is null or p_delivery_distance_km <= 0 or p_delivery_distance_km > v_settings.delivery_max_distance_km then raise exception using errcode='22023', message='The delivery address is outside the service area'; end if;
    v_expected_delivery_fee := round(v_settings.delivery_base_fee + v_settings.delivery_fee_per_km * ceil(p_delivery_distance_km),2);
    if p_delivery_fee is null or p_delivery_fee <> v_expected_delivery_fee then raise exception using errcode='22023', message='The delivery fee changed. Recalculate it and try again'; end if;
    v_delivery_fee := v_expected_delivery_fee;
  else
    if p_delivery_latitude is not null or p_delivery_longitude is not null or p_delivery_distance_km is not null then raise exception using errcode='22023', message='Pickup orders must not include a delivery location'; end if;
    v_delivery_fee := 0;
  end if;
  if p_payment_method='cash_on_pickup' and p_order_type <> 'pickup' then raise exception using errcode='22023', message='Cash on Pickup requires pickup'; end if;
  if p_payment_method='cash_on_delivery' and (p_order_type <> 'delivery' or not v_settings.delivery_enabled) then raise exception using errcode='22023', message='Cash on Delivery is unavailable'; end if;
  if p_payment_method='gcash' and not v_settings.gcash_enabled then raise exception using errcode='22023', message='GCash is currently unavailable'; end if;
  if p_payment_method='maya' and (not v_settings.maya_enabled or length(trim(v_settings.maya_instructions))=0 or length(trim(coalesce(p_reference_number,''))) < 4) then raise exception using errcode='22023', message='Maya is not configured or its payment reference is missing'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity not between 1 and 50 then raise exception using errcode='22023', message='Item quantity must be between 1 and 50'; end if;
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.is_available=true and p.is_archived=false;
    if not found then raise exception using errcode='22023', message='A product in your cart is no longer available'; end if;
    select s.* into v_size from public.product_sizes s where s.id=(v_item->>'size_id')::uuid and s.product_id=v_product.id and s.is_available=true;
    if not found then raise exception using errcode='22023', message='A selected size is no longer available'; end if;
    v_subtotal := v_subtotal + v_size.price * v_quantity;
  end loop;
  if p_payment_method='gcash' and v_subtotal+v_delivery_fee not between 1 and 100000 then raise exception using errcode='22023', message='GCash orders must total between PHP 1.00 and PHP 100,000.00'; end if;
  v_order_id := gen_random_uuid();
  v_order_number := 'DP-' || to_char(now(),'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  insert into public.orders(id,order_number,tracking_token_hash,customer_name,customer_phone,order_type,delivery_address,delivery_latitude,delivery_longitude,delivery_distance_km,notes,subtotal,delivery_fee,total_amount,order_status,payment_method)
    values(v_order_id,v_order_number,p_tracking_token_hash,trim(p_customer_name),trim(p_customer_phone),p_order_type,case when p_order_type='delivery' then trim(p_delivery_address) else null end,p_delivery_latitude,p_delivery_longitude,p_delivery_distance_km,coalesce(trim(p_notes),''),v_subtotal,v_delivery_fee,v_subtotal+v_delivery_fee,'Pending',p_payment_method);
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    select p.* into strict v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.is_available=true and p.is_archived=false;
    select s.* into strict v_size from public.product_sizes s where s.id=(v_item->>'size_id')::uuid and s.product_id=v_product.id and s.is_available=true;
    insert into public.order_items(order_id,product_id,size_id,product_name_snapshot,size_name_snapshot,unit_price_snapshot,quantity,line_total)
      values(v_order_id,v_product.id,v_size.id,v_product.name,v_size.size_name,v_size.price,v_quantity,v_size.price*v_quantity);
  end loop;
  insert into public.payments(order_id,payment_method,amount,payment_status,reference_number)
    values(v_order_id,p_payment_method,v_subtotal+v_delivery_fee,'Pending',nullif(trim(coalesce(p_reference_number,'')),''));
  insert into public.payment_status_history(payment_id,previous_status,new_status,notes)
    select id,null,'Pending','Order placed' from public.payments where order_id=v_order_id;
  return jsonb_build_object('id',v_order_id,'order_number',v_order_number,'subtotal',v_subtotal,'delivery_fee',v_delivery_fee,'delivery_distance_km',p_delivery_distance_km,'total_amount',v_subtotal+v_delivery_fee,'order_status','Pending','payment_status','Pending');
end;
$$;

create or replace function public.admin_save_product(p_product jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_size jsonb;
begin
  if length(trim(coalesce(p_product->>'name',''))) not between 2 and 100 then raise exception using errcode='22023', message='Product name must be 2 to 100 characters'; end if;
  if jsonb_typeof(p_product->'sizes') <> 'array' or jsonb_array_length(p_product->'sizes') < 1 or jsonb_array_length(p_product->'sizes') > 10 then raise exception using errcode='22023', message='Add between 1 and 10 sizes'; end if;
  if nullif(p_product->>'id','') is null then
    insert into public.products(name,description,image_url,category,is_available) values(trim(p_product->>'name'),coalesce(p_product->>'description',''),nullif(trim(coalesce(p_product->>'image_url','')),''),coalesce(nullif(trim(p_product->>'category'),''),'Pizza'),coalesce((p_product->>'is_available')::boolean,true)) returning id into v_id;
  else
    v_id := (p_product->>'id')::uuid;
    update public.products set name=trim(p_product->>'name'),description=coalesce(p_product->>'description',''),image_url=nullif(trim(coalesce(p_product->>'image_url','')),''),category=coalesce(nullif(trim(p_product->>'category'),''),'Pizza'),is_available=coalesce((p_product->>'is_available')::boolean,true),is_archived=false,updated_at=now() where id=v_id;
    if not found then raise exception using errcode='P0002', message='Product not found'; end if;
    delete from public.product_sizes where product_id=v_id;
  end if;
  for v_size in select value from jsonb_array_elements(p_product->'sizes') loop
    if length(trim(coalesce(v_size->>'size_name',''))) not between 1 and 40 or (v_size->>'price')::numeric < 0 then raise exception using errcode='22023', message='Each size needs a name and nonnegative price'; end if;
    insert into public.product_sizes(product_id,size_name,price,is_available) values(v_id,trim(v_size->>'size_name'),(v_size->>'price')::numeric,coalesce((v_size->>'is_available')::boolean,true));
  end loop;
  return v_id;
end;
$$;

create or replace function public.admin_change_order_status(p_order_id uuid,p_new_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  select order_status into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002', message='Order not found'; end if;
  if not ((v_old='Pending' and p_new_status in ('Confirmed','Cancelled')) or (v_old='Confirmed' and p_new_status in ('Preparing','Cancelled')) or (v_old='Preparing' and p_new_status in ('Ready for Pickup','Out for Delivery','Cancelled')) or (v_old='Ready for Pickup' and p_new_status in ('Completed','Cancelled')) or (v_old='Out for Delivery' and p_new_status in ('Completed','Cancelled'))) then
    raise exception using errcode='22023', message='This order status transition is not allowed';
  end if;
  if p_new_status='Out for Delivery' and (select order_type from public.orders where id=p_order_id) <> 'delivery' then raise exception using errcode='22023', message='Pickup orders cannot be marked Out for Delivery'; end if;
  if p_new_status='Ready for Pickup' and (select order_type from public.orders where id=p_order_id) <> 'pickup' then raise exception using errcode='22023', message='Delivery orders cannot be marked Ready for Pickup'; end if;
  update public.orders set order_status=p_new_status,updated_at=now() where id=p_order_id;
end;
$$;

create or replace function public.admin_verify_payment(p_payment_id uuid,p_new_status text,p_admin_id uuid,p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  if p_new_status not in ('Paid','Failed','Refunded') then raise exception using errcode='22023', message='Invalid payment status'; end if;
  select payment_status into v_old from public.payments where id=p_payment_id for update;
  if not found then raise exception using errcode='P0002', message='Payment not found'; end if;
  if not ((v_old='Pending' and p_new_status in ('Paid','Failed')) or (v_old='Paid' and p_new_status='Refunded')) then raise exception using errcode='22023', message='This payment status transition is not allowed'; end if;
  update public.payments set payment_status=p_new_status,verified_by_admin_id=p_admin_id,verified_at=now(),updated_at=now() where id=p_payment_id;
  insert into public.payment_status_history(payment_id,previous_status,new_status,changed_by_admin_id,notes) values(p_payment_id,v_old,p_new_status,p_admin_id,coalesce(trim(p_notes),''));
end;
$$;

create or replace function public.admin_sales_report() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with order_stats as (
    select count(*) total_orders, count(*) filter(where order_status='Pending') pending_orders,
      count(*) filter(where order_status='Completed') completed_orders,
      count(*) filter(where order_status='Cancelled') cancelled_orders,
      coalesce(sum(total_amount) filter(where order_status <> 'Cancelled'),0) order_totals
    from public.orders
  ), payment_stats as (
    select count(*) filter(where payment_status='Paid') confirmed_payments,
      count(*) filter(where payment_status='Pending') pending_payments,
      coalesce(sum(amount) filter(where payment_status in ('Paid','Refunded')),0) gross_collected,
      coalesce(sum(amount) filter(where payment_status='Refunded'),0) refund_totals
    from public.payments
  ), methods as (
    select coalesce(jsonb_agg(jsonb_build_object('payment_method',payment_method,'gross_received',gross_received,'refund_total',refund_total,'pending_total',pending_total)), '[]'::jsonb) rows
    from (select payment_method,coalesce(sum(amount) filter(where payment_status in ('Paid','Refunded')),0) gross_received,coalesce(sum(amount) filter(where payment_status='Refunded'),0) refund_total,coalesce(sum(amount) filter(where payment_status='Pending'),0) pending_total from public.payments group by payment_method) x
  ), days as (
    select coalesce(jsonb_agg(jsonb_build_object('day',sales_date,'paid_total',paid_total) order by sales_date), '[]'::jsonb) rows
    from (select (verified_at at time zone 'Asia/Manila')::date as sales_date,coalesce(sum(amount),0) as paid_total from public.payments where payment_status='Paid' and verified_at >= now()-interval '30 days' group by 1) d
  )
  select jsonb_build_object('total_orders',o.total_orders,'pending_orders',o.pending_orders,'completed_orders',o.completed_orders,'cancelled_orders',o.cancelled_orders,'order_totals',o.order_totals,'confirmed_payments',p.confirmed_payments,'pending_payments',p.pending_payments,'gross_collected',p.gross_collected,'refund_totals',p.refund_totals,'net_collected',p.gross_collected-p.refund_totals,'sales_by_method',m.rows,'daily_sales',d.rows)
  from order_stats o cross join payment_stats p cross join methods m cross join days d;
$$;

revoke all on function public.create_order_atomic(text,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric) from public, anon, authenticated;
revoke all on function public.admin_save_product(jsonb) from public, anon, authenticated;
revoke all on function public.admin_change_order_status(uuid,text) from public, anon, authenticated;
revoke all on function public.admin_verify_payment(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_sales_report() from public, anon, authenticated;
grant execute on function public.create_order_atomic(text,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.admin_save_product(jsonb) to service_role;
grant execute on function public.admin_change_order_status(uuid,text) to service_role;
grant execute on function public.admin_verify_payment(uuid,text,uuid,text) to service_role;
grant execute on function public.admin_sales_report() to service_role;
commit;
