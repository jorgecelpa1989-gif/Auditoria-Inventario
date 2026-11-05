-- =====================================================================
--  CONTROL DE OPERACIONES · Grupo Vector
--  Actualización 08: USUARIOS CON PERMISOS
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No borra datos. Se puede ejecutar más de una vez. Requiere la actualización 07.
--  Compatible con la versión anterior de la app: los 4 celulares fijos (bodega, produccion, retail,
--  distribucion) pasan a ser usuarios con los mismos permisos que tenían y sus links siguen funcionando.
--
--  Permisos:
--    conteo        recibir los conteos de inventario que el supervisor le asigna
--    mp_entregar   entregar materia prima      · mp_recibir   recibir materia prima      (uno u otro)
--    pt_entregar   entregar producto terminado · pt_recibir   recibir PT en bodega
--    pt_retirar    retirar PT para despacho (picking retail)                          (uno de los tres)
--    dev_cargar    cargar devoluciones         · dev_recibir  recepcionar devoluciones
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Usuarios: la tabla de celulares fijos gana nombre, área, permisos y estado ----------
alter table public.cb_puesto drop constraint if exists cb_puesto_id_check;
alter table public.cb_puesto add column if not exists nombre   text;
alter table public.cb_puesto add column if not exists area     text;
alter table public.cb_puesto add column if not exists permisos text[] not null default '{}';
alter table public.cb_puesto add column if not exists activo   boolean not null default true;
alter table public.cb_puesto add constraint cb_puesto_id_check check (id ~ '^[a-z0-9_]{2,40}$');

create or replace function public.cb_u_defecto(p_id text) returns text[]
language sql immutable as $$
  select case p_id
    when 'bodega'       then array['conteo','mp_entregar','pt_recibir','dev_recibir']
    when 'produccion'   then array['mp_recibir','pt_entregar','dev_cargar']
    when 'retail'       then array['pt_retirar','dev_cargar']
    when 'distribucion' then array['dev_cargar']
    else array[]::text[] end
$$;
create or replace function public.cb_u_area_defecto(p_id text) returns text
language sql immutable as $$
  select case p_id when 'bodega' then 'Bodega' when 'produccion' then 'Producción'
    when 'retail' then 'Picking retail' when 'distribucion' then 'Distribución' else null end
$$;

-- Los celulares fijos que ya existen quedan como usuarios (solo la primera vez: nombre vacío).
update public.cb_puesto set permisos = public.cb_u_defecto(id), area = coalesce(area, public.cb_u_area_defecto(id)),
       nombre = 'Celular de ' || coalesce(public.cb_u_area_defecto(id), id)
 where nombre is null;

create or replace function public.cb_u_tiene(p_id text, p_perm text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from cb_puesto where id = p_id and activo and p_perm = any(permisos))
$$;

-- Lado de producto terminado del usuario: E entrega (producción), R recibe (bodega), D retira para despacho (retail).
create or replace function public.cb_u_lado_pt(p_id text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select case when 'pt_entregar' = any(permisos) then 'E' when 'pt_retirar' = any(permisos) then 'D'
              when 'pt_recibir' = any(permisos) then 'R' end
    from cb_puesto where id = p_id and activo
$$;

create or replace function public.cb_puesto_ok(p_puesto text, p_ses text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a cb_puesto;
begin
  select * into a from cb_puesto where id = p_puesto;
  if not found or a.sesion_hash is null or a.sesion_hash <> extensions.crypt(coalesce(p_ses,''), a.sesion_hash) then
    perform pg_sleep(0.5); raise exception 'puesto_invalido';
  end if;
  if not a.activo then raise exception 'usuario_inactivo'; end if;
  update cb_puesto set visto = now() where id = p_puesto;
end $$;

create or replace function public.cb_puesto_vincular(p_puesto text, p_token text, p_equipo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a cb_puesto; v_ses text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into a from cb_puesto where id = p_puesto for update;
  if not found or a.hash <> extensions.crypt(coalesce(p_token,''), a.hash) then perform pg_sleep(0.5); raise exception 'puesto_invalido'; end if;
  if not a.activo then raise exception 'usuario_inactivo'; end if;
  if a.usado is not null then raise exception 'puesto_usado'; end if;
  update cb_puesto set usado = now(), visto = now(), equipo = left(p_equipo, 120), sesion_hash = extensions.crypt(v_ses, extensions.gen_salt('bf')) where id = p_puesto;
  return v_ses;
end $$;

-- Nuevo acceso (link) para un usuario: el equipo anterior queda desconectado.
create or replace function public.cb_puesto_link(p_clave text, p_puesto text, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if coalesce(p_puesto,'') !~ '^[a-z0-9_]{2,40}$' then raise exception 'datos_invalidos'; end if;
  if length(coalesce(p_token,'')) < 16 then raise exception 'clave_corta'; end if;
  if exists (select 1 from cb_puesto where id = p_puesto) then
    update cb_puesto set hash = extensions.crypt(p_token, extensions.gen_salt('bf')), creado = now(), usado = null, sesion_hash = null, equipo = null, visto = null
     where id = p_puesto;
  elsif p_puesto in ('bodega','produccion','retail','distribucion') then
    insert into cb_puesto(id, hash, nombre, area, permisos)
    values (p_puesto, extensions.crypt(p_token, extensions.gen_salt('bf')), 'Celular de ' || cb_u_area_defecto(p_puesto), cb_u_area_defecto(p_puesto), cb_u_defecto(p_puesto));
  else
    raise exception 'no_existe';
  end if;
end $$;

-- Supervisor: lista de usuarios con su estado.
create or replace function public.cb_puesto_estado(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_object_agg(id, jsonb_build_object('creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto, 'persona', persona,
      'nombre', nombre, 'area', area, 'permisos', to_jsonb(permisos), 'activo', activo)) from cb_puesto), '{}'::jsonb);
end $$;

create or replace function public.cb_u_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'area', area, 'permisos', to_jsonb(permisos), 'activo', activo,
      'creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto, 'persona', persona) order by creado) from cb_puesto), '[]'::jsonb);
end $$;

-- Supervisor: crear (p_id vacío) o editar un usuario.
create or replace function public.cb_u_guardar(p_clave text, p_id text, p_nombre text, p_area text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[];
begin
  perform cb_check(p_clave);
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('conteo','mp_entregar','mp_recibir','pt_entregar','pt_recibir','pt_retirar','dev_cargar','dev_recibir')) then raise exception 'datos_invalidos'; end if;
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

create or replace function public.cb_u_eliminar(p_clave text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  update cb_conteos set puesto = null where puesto = p_id;
  delete from cb_puesto where id = p_id;
end $$;

-- Tareas del usuario según sus permisos (y sus datos, para armar su menú).
create or replace function public.cb_puesto_tareas(p_puesto text, p_ses text, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare a cb_puesto; v_rol text;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_persona is not null and p_persona <> '' then update cb_puesto set persona = left(p_persona, 80) where id = p_puesto; end if;
  select * into a from cb_puesto where id = p_puesto;
  v_rol := case when 'mp_entregar' = any(a.permisos) then 'E' when 'mp_recibir' = any(a.permisos) then 'R' end;
  return jsonb_build_object(
    'yo', jsonb_build_object('id', a.id, 'nombre', a.nombre, 'area', a.area, 'permisos', to_jsonb(a.permisos)),
    'mp', case when v_rol is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'ref', m.meta->>'ref', 'por', m.meta->>'por', 'token', m.link_token,
              'creado', m.creado, 'vence', m.vence, 'productos', jsonb_array_length(coalesce(m.meta->'sol','[]'::jsonb)),
              'terminado', (select l.terminado from cb_mov_lado l where l.mov = m.id and l.rol = v_rol)) order by m.creado)
            from cb_mov m where coalesce(m.meta->>'estado','activa') = 'activa' and m.meta->>'puestos' = 'true' and m.finalizado is null
              and m.link_token is not null and (m.vence is null or m.vence > now())), '[]'::jsonb) end,
    'conteos', case when 'conteo' = any(a.permisos) then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'token', c.link_token,
              'creado', c.creado, 'vence', c.vence, 'productos', jsonb_array_length(c.items), 'terminado', c.terminado) order by c.creado)
            from cb_conteos c where c.puesto = p_puesto and c.finalizado is null and c.link_token is not null and (c.vence is null or c.vence > now())), '[]'::jsonb)
            else '[]'::jsonb end,
    'pt_cierre', (select max(t) from cb_pt_cierre where puesto = p_puesto));
end $$;

-- Asignar un conteo a un usuario con permiso de conteo ('' = quitar).
create or replace function public.cb_conteo_asignar(p_clave text, p_id uuid, p_puesto text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if nullif(p_puesto, '') is not null and not cb_u_tiene(p_puesto, 'conteo') then raise exception 'sin_permiso'; end if;
  update cb_conteos set puesto = nullif(p_puesto, '') where id = p_id;
end $$;

-- ---------- Producto terminado: el lado (E/R/D) sale del permiso del usuario ----------
alter table public.cb_pt drop constraint if exists cb_pt_puesto_check;
alter table public.cb_pt add column if not exists lado text;
update public.cb_pt set lado = case puesto when 'produccion' then 'E' when 'retail' then 'D' else 'R' end where lado is null;
alter table public.cb_pt_cierre add column if not exists lado text;
update public.cb_pt_cierre set lado = case puesto when 'produccion' then 'E' when 'retail' then 'D' else 'R' end where lado is null;

create or replace function public.cb_pt_registrar(p_puesto text, p_ses text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_lado text;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  v_lado := cb_u_lado_pt(p_puesto);
  if v_lado is null then raise exception 'sin_permiso'; end if;
  if coalesce(p_data->>'lid','') = '' or coalesce(p_data->>'pallet','') = '' then raise exception 'datos_invalidos'; end if;
  insert into cb_pt(lid, puesto, pallet, data, lado) values (p_data->>'lid', p_puesto, upper(left(p_data->>'pallet', 60)), p_data, v_lado)
  on conflict (lid) do update set pallet = excluded.pallet, data = excluded.data where cb_pt.puesto = p_puesto;
end $$;

create or replace function public.cb_pt_buscar(p_puesto text, p_ses text, p_pallet text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  return (select data from cb_pt where lado = 'E' and pallet = upper(p_pallet) and t > now() - interval '30 days' order by t desc limit 1);
end $$;

create or replace function public.cb_pt_cerrar(p_puesto text, p_ses text, p_persona text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  insert into cb_pt_cierre(puesto, persona, lado) values (p_puesto, left(p_persona, 80), cb_u_lado_pt(p_puesto));
end $$;

-- El panel de PT sigue viendo tres grupos (produccion entrega, bodega recibe, retail retira) aunque haya varios usuarios.
create or replace function public.cb_pt_listar(p_clave text, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_rol(p_clave);
begin
  return jsonb_build_object(
    'pallets', coalesce((select jsonb_agg(data || jsonb_build_object('puesto', case lado when 'E' then 'produccion' when 'D' then 'retail' else 'bodega' end,
        'usuario', puesto, 'pallet', pallet, 'rt', t) order by t) from cb_pt where t >= p_desde), '[]'::jsonb),
    'cierres', coalesce((select jsonb_agg(jsonb_build_object('puesto', case lado when 'E' then 'produccion' when 'D' then 'retail' else 'bodega' end,
        'usuario', puesto, 'persona', persona, 't', t) order by t) from cb_pt_cierre where t >= p_desde - interval '1 day'), '[]'::jsonb),
    'puestos', jsonb_build_object(
        'produccion', (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_entregar' = any(permisos)),
        'bodega',     (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_recibir' = any(permisos)),
        'retail',     (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_retirar' = any(permisos))));
end $$;

-- ---------- Devoluciones: permisos dev_cargar / dev_recibir y el área de quien devuelve ----------
alter table public.cb_dev drop constraint if exists cb_dev_origen_check;
alter table public.cb_dev add column if not exists area text;
update public.cb_dev set area = coalesce(cb_u_area_defecto(origen), origen) where area is null;

create or replace function public.cb_dev_guardar(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_lect jsonb, p_enviar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev; v_id uuid := p_id; v_fecha date;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'dev_cargar') then raise exception 'sin_permiso'; end if;
  if p_lect is null or jsonb_typeof(p_lect) <> 'array' or jsonb_array_length(p_lect) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_lect);
  begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then raise exception 'fecha_invalida'; end;
  if p_enviar then
    if coalesce(trim(p_doc->>'guia'),'') = '' then raise exception 'falta_guia'; end if;
    if coalesce(trim(p_doc->>'factura'),'') = '' then raise exception 'falta_factura'; end if;
    if v_fecha is null then raise exception 'fecha_invalida'; end if;
    if jsonb_array_length(p_lect) = 0 then raise exception 'sin_productos'; end if;
  end if;
  if v_id is not null then
    select * into d from cb_dev where id = v_id for update;
    if not found then v_id := null;
    elsif d.origen <> p_puesto then raise exception 'sin_permiso';
    elsif d.rec_inicio is not null or d.finalizado is not null then raise exception 'en_recepcion';
    end if;
  end if;
  if v_id is null then
    insert into cb_dev(id, origen, area) values (coalesce(p_id, gen_random_uuid()), p_puesto, (select coalesce(nullif(area,''), nombre) from cb_puesto where id = p_puesto)) returning id into v_id;
  end if;
  update cb_dev set persona = left(coalesce(p_doc->>'persona', persona), 80), guia = left(trim(p_doc->>'guia'), 40),
         factura = left(trim(p_doc->>'factura'), 40), fecha = v_fecha, nota = left(p_doc->>'nota', 300),
         lect = p_lect, actualizado = now(), enviado = case when p_enviar then coalesce(enviado, now()) else enviado end
   where id = v_id;
  return jsonb_build_object('id', v_id, 'enviado', (select enviado from cb_dev where id = v_id));
end $$;

-- p_modo: 'carga' (sus devoluciones) o 'rec' (por recibir). Sin modo: recibe si tiene el permiso de recibir.
drop function if exists public.cb_dev_mis(text, text);
create or replace function public.cb_dev_mis(p_puesto text, p_ses text, p_modo text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_rec boolean;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  v_rec := case p_modo when 'rec' then true when 'carga' then false else cb_u_tiene(p_puesto, 'dev_recibir') end;
  if v_rec then
    if not cb_u_tiene(p_puesto, 'dev_recibir') then return '[]'::jsonb; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'origen', d.origen, 'area', d.area, 'persona', d.persona, 'guia', d.guia, 'factura', d.factura,
        'fecha', d.fecha, 'nota', d.nota, 'enviado', d.enviado, 'lect', d.lect, 'rec', d.rec, 'rec_persona', d.rec_persona, 'rec_inicio', d.rec_inicio, 'recibido', d.recibido) order by d.enviado)
      from cb_dev d where d.enviado is not null and d.finalizado is null and (d.recibido is null or d.recibido > now() - interval '18 hours')), '[]'::jsonb);
  end if;
  if not cb_u_tiene(p_puesto, 'dev_cargar') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'area', d.area, 'persona', d.persona, 'guia', d.guia, 'factura', d.factura, 'fecha', d.fecha, 'nota', d.nota,
      'creado', d.creado, 'enviado', d.enviado, 'lect', d.lect, 'rec_inicio', d.rec_inicio, 'recibido', d.recibido, 'finalizado', d.finalizado) order by d.creado desc)
    from cb_dev d where d.origen = p_puesto and d.creado > now() - interval '30 days'), '[]'::jsonb);
end $$;

create or replace function public.cb_dev_recibir(p_puesto text, p_ses text, p_id uuid, p_persona text, p_rec jsonb, p_terminar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'dev_recibir') then raise exception 'sin_permiso'; end if;
  if p_rec is null or jsonb_typeof(p_rec) <> 'array' or jsonb_array_length(p_rec) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_rec);
  select * into d from cb_dev where id = p_id for update;
  if not found or d.enviado is null then raise exception 'no_existe'; end if;
  if d.finalizado is not null then raise exception 'finalizado'; end if;
  if d.recibido is not null then raise exception 'ya_recibida'; end if;
  if p_terminar and jsonb_array_length(p_rec) = 0 then raise exception 'sin_productos'; end if;
  update cb_dev set rec = p_rec, rec_persona = left(p_persona, 80), rec_inicio = coalesce(rec_inicio, now()), actualizado = now(),
         recibido = case when p_terminar then now() else null end
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', case when p_terminar then now() end);
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public.cb_u_defecto(text), public.cb_u_area_defecto(text), public.cb_u_tiene(text, text), public.cb_u_lado_pt(text)
  from public, anon, authenticated;
grant execute on function
  public.cb_puesto_link(text, text, text), public.cb_puesto_estado(text), public.cb_puesto_vincular(text, text, text),
  public.cb_u_listar(text), public.cb_u_guardar(text, text, text, text, jsonb, boolean), public.cb_u_eliminar(text, text),
  public.cb_puesto_tareas(text, text, text), public.cb_conteo_asignar(text, uuid, text),
  public.cb_pt_registrar(text, text, jsonb), public.cb_pt_buscar(text, text, text), public.cb_pt_cerrar(text, text, text), public.cb_pt_listar(text, timestamptz),
  public.cb_dev_guardar(text, text, uuid, jsonb, jsonb, boolean), public.cb_dev_mis(text, text, text), public.cb_dev_recibir(text, text, uuid, text, jsonb, boolean)
to anon, authenticated;
