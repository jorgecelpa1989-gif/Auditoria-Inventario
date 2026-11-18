-- =====================================================================
--  RECEPCIÓN DE PROVEEDORES: OBSERVACIONES + CONTROL DE CALIDAD
--  · obs_rec: observación del operario que recibe (celular). obs_panel: observación del supervisor (panel).
--  · calidad: inspección por código hecha desde el celular por un usuario con permiso "prov_calidad":
--    clasificación (conforme / no conforme / conforme con observaciones), acción, muestreo, embalaje,
--    producto, etiquetado, comentarios y fotos. Queda a nombre del usuario con fecha y hora. Es informativa
--    (no bloquea el cierre). Los códigos deben ser los de la recepción (recibidos o del packing list).
--  · Fotos: cada foto lleva tipo ('rec' recepción, máx. 6 · 'cal' calidad, máx. 30) y su código.
--  Compatible con la app anterior: mismos parámetros (los nuevos tienen valor por defecto).
-- =====================================================================
alter table public.cb_prov add column if not exists obs_rec text, add column if not exists obs_panel text,
  add column if not exists calidad jsonb not null default '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.cb_u_guardar(p_clave text, p_id text, p_nombre text, p_area text, p_permisos jsonb, p_activo boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[];
begin
  perform cb_puede(p_clave, 'usr_admin');
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('conteo','mp_entregar','mp_recibir','pt_entregar','pt_recibir','pt_retirar','dev_cargar','dev_recibir','prov_recibir','prov_calidad','ubic_mover')) then raise exception 'datos_invalidos'; end if;
  if (select count(*) from unnest(v_perm) x where x like 'mp\_%') > 1 then raise exception 'mp_uno'; end if;
  if (select count(*) from unnest(v_perm) x where x like 'pt\_%') > 1 then raise exception 'pt_uno'; end if;
  if v_id is null then
    v_id := 'u_' || encode(extensions.gen_random_bytes(5), 'hex');
    insert into cb_puesto(id, hash, nombre, area, permisos, activo)
    values (v_id, extensions.crypt(encode(extensions.gen_random_bytes(16), 'hex'), extensions.gen_salt('bf')), left(trim(p_nombre), 80), left(trim(coalesce(p_area,'')), 60), v_perm, coalesce(p_activo, true));
  else
    update cb_puesto set nombre = left(trim(p_nombre), 80), area = left(trim(coalesce(p_area,'')), 60), permisos = v_perm, activo = coalesce(p_activo, activo) where id = v_id;
    if not found then raise exception 'no_existe'; end if;
  end if;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.cb_prov_recibir(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_rec jsonb, p_terminar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare p cb_prov; v_fecha date; v_rec jsonb; v_pers text := left(p_doc->>'persona', 80);
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then raise exception 'sin_permiso'; end if;
  if p_id is null then raise exception 'datos_invalidos'; end if;
  perform cb_prov_lineas_ok(p_rec);
  select * into p from cb_prov where id = p_id for update;
  if not found then
    insert into cb_prov(id, origen, persona, fecha) values (p_id, p_puesto, v_pers, (now() at time zone 'America/Santiago')::date)
    returning * into p;
  end if;
  if p.finalizado is not null then raise exception 'finalizado'; end if;
  if p.recibido is not null then raise exception 'ya_recibida'; end if;
  if p.origen = p_puesto then
    begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then v_fecha := null; end;
    update cb_prov set tipo = case when p_doc->>'tipo' = 'importacion' then 'importacion' else 'nacional' end,
           proveedor = left(trim(coalesce(p_doc->>'proveedor','')), 120), guia = left(trim(coalesce(p_doc->>'guia','')), 40),
           referencia = left(trim(coalesce(p_doc->>'referencia','')), 60), contenedor = left(trim(coalesce(p_doc->>'contenedor','')), 40), fecha = coalesce(v_fecha, fecha), nota = left(p_doc->>'nota', 300)
     where id = p_id
    returning * into p;
  else
    -- Recepción cargada en el panel: bodega solo completa lo que quedó vacío (no cambia lo que escribió el supervisor).
    update cb_prov set guia = case when coalesce(guia, '') = '' then left(trim(coalesce(p_doc->>'guia','')), 40) else guia end,
           referencia = case when coalesce(referencia, '') = '' then left(trim(coalesce(p_doc->>'referencia','')), 60) else referencia end,
           contenedor = case when coalesce(contenedor, '') = '' then left(trim(coalesce(p_doc->>'contenedor','')), 40) else contenedor end
     where id = p_id
    returning * into p;
  end if;
  v_rec := cb_rec_mezclar(p.rec, p_rec, p_puesto);
  if p_terminar then
    if jsonb_array_length(v_rec) = 0 then raise exception 'sin_productos'; end if;
    if coalesce(p.guia, '') = '' and coalesce(p.referencia, '') = '' then raise exception 'falta_documento'; end if;
  end if;
  update cb_prov set rec = v_rec, rec_persona = v_pers, obs_rec = case when p_doc ? 'obs' then nullif(left(trim(p_doc->>'obs'), 500), '') else obs_rec end, rec_inicio = coalesce(rec_inicio, now()), actualizado = now(),
         recibido = case when p_terminar then now() else null end
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', case when p_terminar then now() end, 'rec', v_rec);
end $function$;

CREATE OR REPLACE FUNCTION public.cb_prov_mis(p_puesto text, p_ses text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'proveedor', p.proveedor, 'guia', p.guia, 'referencia', p.referencia, 'contenedor', p.contenedor,
      'fecha', p.fecha, 'nota', p.nota, 'origen', p.origen, 'persona', p.persona, 'esperado', p.esperado, 'rec', p.rec,
      'rec_persona', p.rec_persona, 'rec_inicio', p.rec_inicio, 'recibido', p.recibido, 'nfotos', (select count(*) from jsonb_array_elements(p.fotos) x where coalesce(x->>'tipo','rec') = 'rec'), 'obs_rec', p.obs_rec) order by p.creado)
    from cb_prov p where p.anulado is null and p.finalizado is null and (p.recibido is null or p.recibido > now() - interval '18 hours')), '[]'::jsonb);
end $function$;

create or replace function public.cb_prov_obs(p_clave text, p_id uuid, p_obs text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'prov_operar');
  update cb_prov set obs_panel = nullif(left(trim(coalesce(p_obs, '')), 1000), ''), actualizado = now() where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

-- Códigos de una recepción: los recibidos (rec y man) y los del packing list
create or replace function public.cb_prov_codigos(p cb_prov) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct upper(c)), '{}') from (
    select coalesce(nullif(e->>'k',''), e->>'code') c from jsonb_array_elements(coalesce(p.rec,'[]')||coalesce(p.man,'[]')||coalesce(p.esperado,'[]')) e) x
  where coalesce(c,'') <> ''
$$;

create or replace function public.cb_prov_calidad_mis(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_calidad') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'proveedor', p.proveedor, 'guia', p.guia, 'referencia', p.referencia,
      'contenedor', p.contenedor, 'fecha', p.fecha, 'recibido', p.recibido, 'finalizado', p.finalizado, 'esperado', p.esperado, 'rec', p.rec, 'man', p.man,
      'obs_rec', p.obs_rec, 'obs_panel', p.obs_panel, 'calidad', p.calidad,
      'fotos', coalesce((select jsonb_agg(jsonb_build_object('cod', x->>'cod', 't', x->>'t')) from jsonb_array_elements(p.fotos) x where x->>'tipo' = 'cal'), '[]'::jsonb)) order by p.creado desc)
    from cb_prov p where p.anulado is null and p.creado > now() - interval '15 days'
      and (jsonb_array_length(coalesce(p.rec,'[]')) > 0 or jsonb_array_length(coalesce(p.man,'[]')) > 0 or jsonb_array_length(coalesce(p.esperado,'[]')) > 0)), '[]'::jsonb);
end $$;

create or replace function public.cb_prov_calidad_guardar(p_puesto text, p_ses text, p_id uuid, p_cal jsonb, p_terminar boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov; a cb_puesto; v_cods text[]; v_mal text; v_old jsonb; v_new jsonb;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_calidad') then raise exception 'sin_permiso'; end if;
  if p_cal is null or jsonb_typeof(p_cal) <> 'object' or length(p_cal::text) > 200000 then raise exception 'datos_invalidos'; end if;
  if p_cal ? 'codigos' and jsonb_typeof(p_cal->'codigos') <> 'object' then raise exception 'datos_invalidos'; end if;
  select * into p from cb_prov where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if p.anulado is not null then raise exception 'anulado'; end if;
  v_cods := cb_prov_codigos(p);
  select k into v_mal from jsonb_object_keys(coalesce(p_cal->'codigos','{}'::jsonb)) k where not (upper(k) = any(v_cods)) limit 1;
  if v_mal is not null then raise exception 'codigo_no_existe'; end if;
  select * into a from cb_puesto where id = p_puesto;
  v_old := coalesce(p.calidad, '{}'::jsonb);
  v_new := jsonb_build_object('general', coalesce(p_cal->'general', '{}'::jsonb), 'codigos', coalesce(p_cal->'codigos', '{}'::jsonb),
    'resp', jsonb_build_object('puesto', p_puesto, 'nombre', a.nombre, 'persona', left(coalesce(p_cal->>'persona', ''), 80)),
    'inicio', coalesce(v_old->'inicio', to_jsonb(now())), 't', now(),
    'estado', case when p_terminar or v_old->>'estado' = 'terminada' then 'terminada' else 'en_curso' end,
    'fin', case when p_terminar then to_jsonb(now()) else v_old->'fin' end,
    'hist', coalesce(v_old->'hist', '[]'::jsonb) || case when v_old->>'estado' = 'terminada' then jsonb_build_array(jsonb_build_object('t', now(), 'por', left(coalesce(p_cal->>'persona', a.nombre), 80), 'que', 'modificada'))
                                                       when p_terminar then jsonb_build_array(jsonb_build_object('t', now(), 'por', left(coalesce(p_cal->>'persona', a.nombre), 80), 'que', 'terminada')) else '[]'::jsonb end);
  update cb_prov set calidad = v_new, actualizado = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'estado', v_new->>'estado', 't', now());
end $$;

-- Fotos: tipo 'rec' (recepción, permiso prov_recibir, máx. 6) o 'cal' (calidad, permiso prov_calidad, máx. 30, también con la recepción cerrada)
drop function if exists public.cb_prov_foto_puede(text, text, uuid);
create or replace function public.cb_prov_foto_puede(p_puesto text, p_ses text, p_id uuid, p_tipo text default 'rec') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov; v_cal boolean := p_tipo = 'cal'; n int; v_max int := case when p_tipo = 'cal' then 30 else 6 end;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_tipo not in ('rec','cal') then raise exception 'datos_invalidos'; end if;
  if not cb_u_tiene(p_puesto, (case when v_cal then 'prov_calidad' else 'prov_recibir' end)) then raise exception 'sin_permiso'; end if;
  select * into p from cb_prov where id = p_id;
  if not found then raise exception 'no_existe'; end if;
  if p.anulado is not null then raise exception 'anulado'; end if;
  if p.finalizado is not null and not v_cal then raise exception 'finalizado'; end if;
  select count(*) into n from jsonb_array_elements(p.fotos) x where coalesce(x->>'tipo','rec') = p_tipo;
  if n >= v_max then raise exception 'max_fotos'; end if;
end $$;
drop function if exists public.cb_prov_foto_agregar(text, text, uuid, text, text);
create or replace function public.cb_prov_foto_agregar(p_puesto text, p_ses text, p_id uuid, p_path text, p_persona text, p_tipo text default 'rec', p_cod text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov; n int; v_max int := case when p_tipo = 'cal' then 30 else 6 end;
begin
  perform cb_prov_foto_puede(p_puesto, p_ses, p_id, p_tipo);
  if p_path is null or p_path not like p_id::text || '/%' or length(p_path) > 120 then raise exception 'datos_invalidos'; end if;
  select * into p from cb_prov where id = p_id for update;
  if p_cod is not null and p_cod <> '' and not (upper(p_cod) = any(cb_prov_codigos(p))) then raise exception 'codigo_no_existe'; end if;
  select count(*) into n from jsonb_array_elements(p.fotos) x where coalesce(x->>'tipo','rec') = p_tipo;
  if n >= v_max then raise exception 'max_fotos'; end if;
  update cb_prov set fotos = fotos || jsonb_build_array(jsonb_build_object('path', p_path, 't', now(), 'persona', left(coalesce(p_persona, ''), 80), 'pu', p_puesto,
           'tipo', p_tipo, 'cod', nullif(left(coalesce(p_cod, ''), 40), ''))), actualizado = now()
   where id = p_id;
  return jsonb_build_object('n', n + 1);
end $$;

revoke execute on function public.cb_prov_foto_puede(text, text, uuid, text), public.cb_prov_foto_agregar(text, text, uuid, text, text, text, text),
  public.cb_prov_codigos(cb_prov) from public, anon, authenticated;
grant execute on function public.cb_prov_foto_puede(text, text, uuid, text), public.cb_prov_foto_agregar(text, text, uuid, text, text, text, text) to service_role;
grant execute on function public.cb_prov_obs(text, uuid, text), public.cb_prov_calidad_mis(text, text), public.cb_prov_calidad_guardar(text, text, uuid, jsonb, boolean) to anon, authenticated;
