-- =====================================================================
--  Producción PT (PC del panel): registrar pallets con N° correlativo e imprimir su etiqueta.
--  Permiso nuevo de supervisor: pt_producir. Solo agrega: los celulares y Recepción PT siguen igual
--  (el pallet queda en cb_pt como "Producción entrega", lado E, igual que desde el celular).
-- =====================================================================
create sequence if not exists public.cb_pt_pallet_seq;
revoke all on sequence public.cb_pt_pallet_seq from public, anon, authenticated;

create or replace function public.cb_pt_prod_registrar(p_clave text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_lid text; v_pal text; v_t timestamptz := now(); v_q numeric; v_f numeric; v_d jsonb;
begin
  perform cb_puede(p_clave, 'pt_producir');
  if coalesce(trim(p_data->>'code'), '') = '' then raise exception 'datos_invalidos'; end if;
  begin v_q := (p_data->>'qty')::numeric; v_f := coalesce(nullif(p_data->>'f', '')::numeric, 1);
  exception when others then raise exception 'cantidad_invalida'; end;
  if v_q is null or v_q <= 0 or v_q > 1000000 then raise exception 'cantidad_invalida'; end if;
  v_lid := 'pc-' || encode(extensions.gen_random_bytes(8), 'hex');
  v_pal := 'P' || lpad(nextval('public.cb_pt_pallet_seq')::text, 6, '0');
  v_d := jsonb_build_object('lid', v_lid, 'pallet', v_pal, 'code', left(trim(p_data->>'code'), 40),
    'k', left(trim(coalesce(nullif(p_data->>'k', ''), p_data->>'code')), 40), 'desc', left(coalesce(p_data->>'desc', ''), 200),
    'um', left(coalesce(p_data->>'um', ''), 20), 'qty', v_q, 'user', left(coalesce(cb_sup_nombre(p_clave), nullif(p_data->>'user', ''), 'Supervisor'), 80),
    't', v_t, 'via', 'pc', 'imp', jsonb_build_array(v_t));
  if coalesce(p_data->>'ce', '') <> '' and v_f > 0 and v_f <> 1 then
    v_d := v_d || jsonb_build_object('ce', left(p_data->>'ce', 20), 'f', v_f);
  end if;
  insert into cb_pt(lid, puesto, pallet, data, t, lado) values (v_lid, 'panel_prod', v_pal, v_d, v_t, 'E');
  return v_d;
end $$;

-- Pallets registrados desde el PC en un día (para reimprimir o corregir).
create or replace function public.cb_pt_prod_dia(p_clave text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_ini timestamptz;
begin
  perform cb_puede(p_clave, 'pt_producir');
  if p_dia is null then raise exception 'fecha_invalida'; end if;
  v_ini := p_dia::timestamp at time zone 'America/Santiago';
  return coalesce((select jsonb_agg(data || jsonb_build_object('rt', t) order by t) from cb_pt
                    where puesto = 'panel_prod' and data->>'via' = 'pc' and t >= v_ini and t < v_ini + interval '1 day'), '[]'::jsonb);
end $$;

-- Anota cada reimpresión de la etiqueta (queda el historial en el registro).
create or replace function public.cb_pt_prod_impreso(p_clave text, p_lid text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'pt_producir');
  update cb_pt set data = data || jsonb_build_object('imp', coalesce(data->'imp', '[]'::jsonb) || to_jsonb(now()))
   where lid = p_lid and puesto = 'panel_prod' and data->>'via' = 'pc';
  if not found then raise exception 'no_existe'; end if;
end $$;

-- Corrige la cantidad de un pallet hecho desde el PC (0 = anular), igual que el celular de producción.
create or replace function public.cb_pt_prod_corregir(p_clave text, p_lid text, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r cb_pt;
begin
  perform cb_puede(p_clave, 'pt_producir');
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  select * into r from cb_pt where lid = p_lid and puesto = 'panel_prod' and data->>'via' = 'pc' for update;
  if not found then raise exception 'no_existe'; end if;
  if r.t < now() - interval '15 days' then raise exception 'muy_antiguo'; end if;
  update cb_pt set data = data || jsonb_build_object('qty', p_qty, 'ed', coalesce(data->'ed', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object('de', data->'qty', 'a', p_qty, 'por', left(coalesce(cb_sup_nombre(p_clave), 'Supervisor'), 80), 't', now(), 'via', 'pc')))
   where lid = p_lid;
  return (select data from cb_pt where lid = p_lid);
end $$;

-- Permiso nuevo de supervisor: pt_producir (Producción PT en el PC).
create or replace function public.cb_sup_guardar(p_clave text, p_id text, p_nombre text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[]; par record;
begin
  perform cb_check(p_clave);
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('inv_ver','inv_operar','mp_ver','mp_solicitar','mp_operar','mp_eliminar',
      'pt_ver','pt_corregir','pt_producir','dev_ver','dev_crear','dev_todas','dev_cerrar','dev_eliminar','usr_admin',
      'prov_ver','prov_operar','prov_eliminar','ubi_ver','ubi_operar')) then raise exception 'datos_invalidos'; end if;
  -- para operar o eliminar hay que poder ver el módulo
  for par in select * from (values ('inv_operar','inv_ver'),('mp_solicitar','mp_ver'),('mp_operar','mp_ver'),('mp_operar','mp_solicitar'),('mp_eliminar','mp_ver'),
      ('pt_corregir','pt_ver'),('dev_crear','dev_ver'),('dev_todas','dev_ver'),('dev_cerrar','dev_ver'),('dev_eliminar','dev_ver'),
      ('prov_operar','prov_ver'),('prov_eliminar','prov_ver'),('ubi_operar','ubi_ver')) v(hijo, padre) loop
    if par.hijo = any(v_perm) and not (par.padre = any(v_perm)) then v_perm := v_perm || par.padre; end if;
  end loop;
  if v_id is null then
    if (select count(*) from cb_sup) >= 50 then raise exception 'datos_invalidos'; end if;
    v_id := 's_' || encode(extensions.gen_random_bytes(5), 'hex');
    insert into cb_sup(id, nombre, permisos, activo) values (v_id, left(trim(p_nombre), 80), v_perm, coalesce(p_activo, true));
  else
    update cb_sup set nombre = left(trim(p_nombre), 80), permisos = v_perm, activo = coalesce(p_activo, activo) where id = v_id;
    if not found then raise exception 'no_existe'; end if;
  end if;
  return v_id;
end $$;

revoke all on function public.cb_pt_prod_registrar(text, jsonb), public.cb_pt_prod_dia(text, date),
  public.cb_pt_prod_impreso(text, text), public.cb_pt_prod_corregir(text, text, numeric) from public;
grant execute on function public.cb_pt_prod_registrar(text, jsonb), public.cb_pt_prod_dia(text, date),
  public.cb_pt_prod_impreso(text, text), public.cb_pt_prod_corregir(text, text, numeric) to anon, authenticated;
