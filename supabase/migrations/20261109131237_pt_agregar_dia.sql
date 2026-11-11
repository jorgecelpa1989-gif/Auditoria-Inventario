
-- =====================================================================
--  Actualización 14 · PT: agregar un pallet olvidado en un día anterior
--  · Celular (quien entrega o recibe PT): agrega un registro propio en un día de los últimos 14.
--  · Panel del supervisor: agrega un registro de producción, bodega o retail en cualquier día.
--  El registro queda con la fecha/hora de ese día y marcado como "agregado a mano" (quién y cuándo).
--  Solo agrega funciones: la app anterior sigue funcionando igual.
-- =====================================================================

create or replace function public.cb_pt_agregar_dia(p_puesto text, p_ses text, p_dia date, p_hora text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_lado text; v_hoy date := (now() at time zone 'America/Santiago')::date; v_t timestamptz; v_lid text;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  v_lado := cb_u_lado_pt(p_puesto);
  if v_lado is null then raise exception 'sin_permiso'; end if;
  if p_dia is null or p_dia > v_hoy or p_dia < v_hoy - 14 then raise exception 'fecha_invalida'; end if;
  if coalesce(p_data->>'code','') = '' or coalesce((p_data->>'qty')::numeric, 0) <= 0 then raise exception 'datos_invalidos'; end if;
  v_t := (p_dia + coalesce(nullif(p_hora,'')::time, time '12:00')) at time zone 'America/Santiago';
  if v_t > now() then v_t := now(); end if;
  v_lid := 'man-' || encode(extensions.gen_random_bytes(8), 'hex');
  insert into cb_pt(lid, puesto, pallet, data, t, lado)
  values (v_lid, p_puesto, upper(left(coalesce(nullif(p_data->>'pallet',''), 'SN-' || v_lid), 60)),
          p_data || jsonb_build_object('lid', v_lid, 't', v_t, 'manual', jsonb_build_object('por', p_data->>'user', 'at', now(), 'via', 'celular')), v_t, v_lado);
  return jsonb_build_object('lid', v_lid, 't', v_t);
end $$;

create or replace function public.cb_pt_agregar_panel(p_clave text, p_dia date, p_hora text, p_lado text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_t timestamptz; v_lid text; v_puesto text;
begin
  perform cb_check(p_clave);
  if p_lado not in ('E','R','D') then raise exception 'datos_invalidos'; end if;
  if p_dia is null or p_dia > (now() at time zone 'America/Santiago')::date then raise exception 'fecha_invalida'; end if;
  if coalesce(p_data->>'code','') = '' or coalesce((p_data->>'qty')::numeric, 0) <= 0 then raise exception 'datos_invalidos'; end if;
  v_t := (p_dia + coalesce(nullif(p_hora,'')::time, time '12:00')) at time zone 'America/Santiago';
  if v_t > now() then v_t := now(); end if;
  v_lid := 'man-' || encode(extensions.gen_random_bytes(8), 'hex');
  v_puesto := case p_lado when 'E' then 'panel_prod' when 'D' then 'panel_retail' else 'panel_bodega' end;
  insert into cb_pt(lid, puesto, pallet, data, t, lado)
  values (v_lid, v_puesto, upper(left(coalesce(nullif(p_data->>'pallet',''), 'SN-' || v_lid), 60)),
          p_data || jsonb_build_object('lid', v_lid, 't', v_t, 'manual', jsonb_build_object('por', coalesce(p_data->>'user','Supervisor'), 'at', now(), 'via', 'panel')), v_t, p_lado);
  return jsonb_build_object('lid', v_lid, 't', v_t);
end $$;

revoke all on function public.cb_pt_agregar_dia(text, text, date, text, jsonb), public.cb_pt_agregar_panel(text, date, text, text, jsonb) from public;
grant execute on function public.cb_pt_agregar_dia(text, text, date, text, jsonb), public.cb_pt_agregar_panel(text, date, text, text, jsonb) to anon, authenticated;
