-- =====================================================================
--  Actualización 19 · Recepción de proveedores (módulo 7)
--  El panel crea la recepción (tipo nacional o importación, proveedor, N° de guía, N° de referencia,
--  fecha) con su packing list (lo esperado). Bodega la recibe desde el celular (permiso de usuario
--  "prov_recibir"): acepta o corrige lo que llega, o crea una recepción propia sin packing list.
--  El panel ve el cuadre esperado vs recibido, agrega o corrige registros y cierra.
--  Permisos de supervisor: prov_ver · prov_operar · prov_eliminar.
--  Solo agrega cosas: la app anterior sigue funcionando igual.
-- =====================================================================

create table if not exists public.cb_prov (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null default 'nacional' check (tipo in ('nacional','importacion')),
  proveedor    text,
  guia         text,
  referencia   text,                               -- orden de compra, factura, contenedor o carpeta
  fecha        date,
  nota         text,
  origen       text not null default 'panel',      -- 'panel' o el usuario (celular) que la creó
  persona      text,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  esperado     jsonb not null default '[]'::jsonb, -- packing list
  rec          jsonb not null default '[]'::jsonb, -- lo que bodega registró desde el celular
  man          jsonb not null default '[]'::jsonb, -- registros agregados a mano desde el panel
  rec_persona  text,
  rec_inicio   timestamptz,
  recibido     timestamptz,                        -- bodega terminó la recepción
  finalizado   timestamptz                         -- el supervisor la cerró
);
create index if not exists cb_prov_creado_idx on public.cb_prov (creado desc);
alter table public.cb_prov enable row level security;
revoke all on public.cb_prov from public, anon, authenticated;

-- Líneas válidas: arreglo de objetos con código y cantidad (número entre 0 y 1.000.000).
create or replace function public.cb_prov_lineas_ok(p jsonb, p_max int default 5000) returns void
language plpgsql immutable set search_path = public, extensions as $$
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > p_max then raise exception 'datos_invalidos'; end if;
  if exists (select 1 from jsonb_array_elements(p) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'code', e->>'k', '') = ''
                 or coalesce(jsonb_typeof(e->'qty'), '') <> 'number') then
    raise exception 'datos_invalidos';
  end if;
  if exists (select 1 from jsonb_array_elements(p) e where (e->>'qty')::numeric < 0 or (e->>'qty')::numeric > 1000000) then
    raise exception 'datos_invalidos';
  end if;
end $$;
revoke execute on function public.cb_prov_lineas_ok(jsonb, int) from public, anon, authenticated;

-- ---------- Panel ----------
create or replace function public.cb_prov_listar(p_clave text, p_desde timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'prov_ver');
begin
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.creado desc) from cb_prov p
    where p.creado > coalesce(p_desde, now() - interval '120 days')), '[]'::jsonb);
end $$;

-- Crea o edita la recepción: datos del documento y packing list (agregar o quitar productos esperados).
create or replace function public.cb_prov_guardar(p_clave text, p_id uuid, p_doc jsonb, p_esperado jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'prov_operar'); v_id uuid := p_id; v_fecha date; p cb_prov;
begin
  perform cb_prov_lineas_ok(coalesce(p_esperado, '[]'::jsonb));
  begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then raise exception 'fecha_invalida'; end;
  if v_fecha is null then raise exception 'fecha_invalida'; end if;
  if coalesce(trim(p_doc->>'guia'),'') = '' and coalesce(trim(p_doc->>'referencia'),'') = '' then raise exception 'falta_documento'; end if;
  if v_id is not null then
    select * into p from cb_prov where id = v_id for update;
    if not found then v_id := null; elsif p.finalizado is not null then raise exception 'finalizado'; end if;
  end if;
  if v_id is null then
    insert into cb_prov(id, origen, persona) values (coalesce(p_id, gen_random_uuid()), 'panel', left(coalesce(cb_sup_nombre(p_clave), nullif(p_doc->>'persona',''), 'Supervisor'), 80))
    returning id into v_id;
  end if;
  update cb_prov set tipo = case when p_doc->>'tipo' = 'importacion' then 'importacion' else 'nacional' end,
         proveedor = left(trim(coalesce(p_doc->>'proveedor','')), 120), guia = left(trim(coalesce(p_doc->>'guia','')), 40),
         referencia = left(trim(coalesce(p_doc->>'referencia','')), 60), fecha = v_fecha, nota = left(p_doc->>'nota', 300),
         esperado = coalesce(p_esperado, '[]'::jsonb), actualizado = now()
   where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Agregar un registro recibido que faltó (queda aparte de lo que envía el celular, que no lo borra).
create or replace function public.cb_prov_agregar_panel(p_clave text, p_id uuid, p_hora text, p_linea jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'prov_operar'); p cb_prov; v_t timestamptz; v_lid text; v_dia date;
begin
  perform cb_prov_lineas_ok(jsonb_build_array(p_linea), 1);
  if (p_linea->>'qty')::numeric <= 0 then raise exception 'datos_invalidos'; end if;
  select * into p from cb_prov where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if p.finalizado is not null then raise exception 'finalizado'; end if;
  v_dia := coalesce(p.fecha, (p.creado at time zone 'America/Santiago')::date);
  begin v_t := (v_dia + coalesce(nullif(p_hora,'')::time, time '12:00')) at time zone 'America/Santiago';
  exception when others then raise exception 'datos_invalidos'; end;
  if v_t > now() then v_t := now(); end if;
  v_lid := 'man-' || encode(extensions.gen_random_bytes(8), 'hex');
  update cb_prov set man = man || jsonb_build_array(p_linea || jsonb_build_object('lid', v_lid, 't', v_t,
           'user', coalesce(cb_sup_nombre(p_clave), 'Supervisor'), 'manual', true)), actualizado = now()
   where id = p_id;
  return jsonb_build_object('lid', v_lid, 't', v_t);
end $$;

-- Corregir la cantidad de un registro (0 = anular; queda el historial). Lo que registró el celular se
-- corrige recién cuando bodega terminó, para que su próximo envío no lo pise.
create or replace function public.cb_prov_corregir(p_clave text, p_id uuid, p_lid text, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'prov_operar'); p cb_prov; v_por text := left(coalesce(cb_sup_nombre(p_clave), 'Supervisor'), 80);
begin
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  select * into p from cb_prov where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if p.finalizado is not null then raise exception 'finalizado'; end if;
  if exists (select 1 from jsonb_array_elements(p.man) e where e->>'lid' = p_lid) then
    update cb_prov set man = (select jsonb_agg(case when x.e->>'lid' = p_lid then x.e || jsonb_build_object('qty', p_qty, 'ed', coalesce(x.e->'ed', '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('de', x.e->'qty', 'a', p_qty, 'por', v_por, 't', now()))) else x.e end order by x.o)
             from jsonb_array_elements(p.man) with ordinality x(e, o)), actualizado = now()
     where id = p_id;
  elsif exists (select 1 from jsonb_array_elements(p.rec) e where e->>'lid' = p_lid) then
    if p.recibido is null then raise exception 'en_recepcion'; end if;
    update cb_prov set rec = (select jsonb_agg(case when x.e->>'lid' = p_lid then x.e || jsonb_build_object('qty', p_qty, 'ed', coalesce(x.e->'ed', '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('de', x.e->'qty', 'a', p_qty, 'por', v_por, 't', now()))) else x.e end order by x.o)
             from jsonb_array_elements(p.rec) with ordinality x(e, o)), actualizado = now()
     where id = p_id;
  else
    raise exception 'no_existe';
  end if;
  return jsonb_build_object('id', p_id, 'lid', p_lid, 'qty', p_qty);
end $$;

create or replace function public.cb_prov_cerrar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'prov_operar');
  update cb_prov set finalizado = coalesce(finalizado, now()), actualizado = now() where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

create or replace function public.cb_prov_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'prov_eliminar');
  delete from cb_prov where id = p_id;
end $$;

-- ---------- Celular de bodega (permiso de usuario "prov_recibir") ----------
create or replace function public.cb_prov_mis(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'proveedor', p.proveedor, 'guia', p.guia, 'referencia', p.referencia,
      'fecha', p.fecha, 'nota', p.nota, 'origen', p.origen, 'persona', p.persona, 'esperado', p.esperado, 'rec', p.rec,
      'rec_persona', p.rec_persona, 'rec_inicio', p.rec_inicio, 'recibido', p.recibido) order by p.creado)
    from cb_prov p where p.finalizado is null and (p.recibido is null or p.recibido > now() - interval '18 hours')), '[]'::jsonb);
end $$;

-- Guarda lo recibido (y termina, si p_terminar). Si la recepción no existe, la crea este celular
-- (sin packing list) y puede editar sus datos mientras no la termine.
create or replace function public.cb_prov_recibir(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_rec jsonb, p_terminar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov; v_fecha date; v_pers text := left(p_doc->>'persona', 80);
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
           referencia = left(trim(coalesce(p_doc->>'referencia','')), 60), fecha = coalesce(v_fecha, fecha), nota = left(p_doc->>'nota', 300)
     where id = p_id
    returning * into p;
  end if;
  if p_terminar then
    if jsonb_array_length(p_rec) = 0 then raise exception 'sin_productos'; end if;
    if coalesce(p.guia, '') = '' and coalesce(p.referencia, '') = '' then raise exception 'falta_documento'; end if;
  end if;
  update cb_prov set rec = p_rec, rec_persona = v_pers, rec_inicio = coalesce(rec_inicio, now()), actualizado = now(),
         recibido = case when p_terminar then now() else null end
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', case when p_terminar then now() end);
end $$;

revoke all on function public.cb_prov_listar(text, timestamptz), public.cb_prov_guardar(text, uuid, jsonb, jsonb),
  public.cb_prov_agregar_panel(text, uuid, text, jsonb), public.cb_prov_corregir(text, uuid, text, numeric),
  public.cb_prov_cerrar(text, uuid), public.cb_prov_eliminar(text, uuid),
  public.cb_prov_mis(text, text), public.cb_prov_recibir(text, text, uuid, jsonb, jsonb, boolean) from public;
grant execute on function public.cb_prov_listar(text, timestamptz), public.cb_prov_guardar(text, uuid, jsonb, jsonb),
  public.cb_prov_agregar_panel(text, uuid, text, jsonb), public.cb_prov_corregir(text, uuid, text, numeric),
  public.cb_prov_cerrar(text, uuid), public.cb_prov_eliminar(text, uuid),
  public.cb_prov_mis(text, text), public.cb_prov_recibir(text, text, uuid, jsonb, jsonb, boolean) to anon, authenticated;

-- Permisos nuevos: supervisores (prov_ver, prov_operar, prov_eliminar) y usuarios de celular (prov_recibir).
create or replace function public.cb_sup_guardar(p_clave text, p_id text, p_nombre text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[]; par record;
begin
  perform cb_check(p_clave);
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('inv_ver','inv_operar','mp_ver','mp_solicitar','mp_operar','mp_eliminar',
      'pt_ver','pt_corregir','dev_ver','dev_crear','dev_todas','dev_cerrar','dev_eliminar','usr_admin',
      'prov_ver','prov_operar','prov_eliminar')) then raise exception 'datos_invalidos'; end if;
  -- para operar o eliminar hay que poder ver el módulo
  for par in select * from (values ('inv_operar','inv_ver'),('mp_solicitar','mp_ver'),('mp_operar','mp_ver'),('mp_operar','mp_solicitar'),('mp_eliminar','mp_ver'),
      ('pt_corregir','pt_ver'),('dev_crear','dev_ver'),('dev_todas','dev_ver'),('dev_cerrar','dev_ver'),('dev_eliminar','dev_ver'),
      ('prov_operar','prov_ver'),('prov_eliminar','prov_ver')) v(hijo, padre) loop
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

create or replace function public.cb_u_guardar(p_clave text, p_id text, p_nombre text, p_area text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[];
begin
  perform cb_puede(p_clave, 'usr_admin');
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('conteo','mp_entregar','mp_recibir','pt_entregar','pt_recibir','pt_retirar','dev_cargar','dev_recibir','prov_recibir')) then raise exception 'datos_invalidos'; end if;
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
end $$;
