-- Add PayMongo Checkout support metadata and Google Routes distance-based delivery pricing.
-- Safe to rerun after the first successful application.
begin;

alter table public.orders
  add column if not exists delivery_latitude numeric(10,7),
  add column if not exists delivery_longitude numeric(10,7),
  add column if not exists delivery_distance_km numeric(8,2);

alter table public.payments
  add column if not exists gateway_session_id text,
  add column if not exists gateway_checkout_url text,
  add column if not exists gateway_payment_id text;

create unique index if not exists payments_gateway_session_uidx
  on public.payments(gateway_session_id) where gateway_session_id is not null;

alter table public.business_settings
  add column if not exists business_latitude numeric(10,7),
  add column if not exists business_longitude numeric(10,7),
  add column if not exists delivery_base_fee numeric(10,2) not null default 0,
  add column if not exists delivery_fee_per_km numeric(10,2) not null default 0,
  add column if not exists delivery_max_distance_km numeric(8,2) not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.business_settings'::regclass and conname='business_settings_business_latitude_check') then
    alter table public.business_settings add constraint business_settings_business_latitude_check check (business_latitude is null or business_latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.business_settings'::regclass and conname='business_settings_business_longitude_check') then
    alter table public.business_settings add constraint business_settings_business_longitude_check check (business_longitude is null or business_longitude between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.business_settings'::regclass and conname='business_settings_delivery_base_fee_check') then
    alter table public.business_settings add constraint business_settings_delivery_base_fee_check check (delivery_base_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.business_settings'::regclass and conname='business_settings_delivery_fee_per_km_check') then
    alter table public.business_settings add constraint business_settings_delivery_fee_per_km_check check (delivery_fee_per_km >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.business_settings'::regclass and conname='business_settings_delivery_max_distance_km_check') then
    alter table public.business_settings add constraint business_settings_delivery_max_distance_km_check check (delivery_max_distance_km >= 0);
  end if;
end $$;

-- Preserve the previous flat delivery fee as the new base charge where one was set.
update public.business_settings set delivery_base_fee=delivery_fee where id=true and delivery_base_fee=0 and delivery_fee>0;

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
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_delivery_fee numeric(10,2) := 0;
  v_expected_delivery_fee numeric(10,2);
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

revoke all on function public.create_order_atomic(text,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.create_order_atomic(text,text,text,text,text,text,text,text,jsonb,numeric,numeric,numeric,numeric) to service_role;

commit;
