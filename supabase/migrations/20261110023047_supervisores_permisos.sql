-- =====================================================================
--  Actualización 17 · Supervisores con nombre y permisos por módulo
--  Cada supervisor entra con su propio link (una sola vez, queda amarrado a su equipo) y
--  solo puede ver / hacer lo que el administrador le marque:
--    mp_ver        ver el panel de Entrega de MP y su detalle
--    mp_solicitar  crear solicitudes de MP
--    pt_ver        ver la cuadratura de Recepción de PT (y exportarla)
--    dev_ver       ver las devoluciones de Producción
--    dev_crear     crear devoluciones de Producción
--  Nunca puede: eliminar, corregir, cerrar, bloquear/liberar, ni entrar a Inventario o Permisos
--  (esas funciones siguen pidiendo la clave del administrador).
--  La clave del administrador y el acceso antiguo de producción siguen funcionando igual.
-- =====================================================================

create table if not exists public.cb_sup (
  id          text primary key,
  nombre      text not null,
  permisos    text[] not null default '{}',
  activo      boolean not null default true,
  hash        text,
  sesion_hash text,
  creado      timestamptz not null default now(),
  usado       timestamptz,
  equipo      text,
  visto       timestamptz
);
alter table public.cb_sup enable row level security;
revoke all on public.cb_sup from public, anon, authenticated;

-- Sesión de supervisor: "s_<id>.<secreto>". Devuelve la fila, o una fila vacía si no es válida.
create or replace function public.cb_sup_de(p_clave text) returns public.cb_sup
language plpgsql security definer set search_path = public, extensions as $$
declare s cb_sup; v_id text := split_part(coalesce(p_clave,''), '.', 1); v_sec text := split_part(coalesce(p_clave,''), '.', 2);
begin
  if v_id !~ '^s_[0-9a-f]{6,20}$' or length(v_sec) < 16 then return null; end if;
  select * into s from cb_sup where id = v_id;
  if not found or s.sesion_hash is null or s.sesion_hash <> extensions.crypt(v_sec, s.sesion_hash) then return null; end if;
  return s;
end $$;

-- ¿Quién llama y puede hacer esto?  Devuelve 'admin', 'prod' (acceso antiguo) o 'sup'; si no, error.
--   p_perm = '*'  → cualquier supervisor activo (por ejemplo, para leer la lista de productos).
create or replace function public.cb_puede(p_clave text, p_perm text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare s cb_sup; r text;
begin
  if coalesce(p_clave,'') like 's\_%.%' then
    s := cb_sup_de(p_clave);
    if s.id is null then perform pg_sleep(0.5); raise exception 'acceso_produccion'; end if;
    if not s.activo then raise exception 'usuario_inactivo'; end if;
    if p_perm <> '*' and not (p_perm = any(s.permisos)) then raise exception 'sin_permiso'; end if;
    update cb_sup set visto = now() where id = s.id;
    return 'sup';
  end if;
  r := cb_rol(p_clave);                                  -- admin o acceso antiguo de producción (o error)
  if r = 'prod' and p_perm not in ('*','mp_ver','mp_solicitar','pt_ver') then raise exception 'sin_permiso'; end if;
  return r;
end $$;

revoke execute on function public.cb_sup_de(text), public.cb_puede(text, text) from public, anon, authenticated;

-- ---------- Administrador: crear, editar, dar link, eliminar ----------
create or replace function public.cb_sup_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'permisos', to_jsonb(permisos), 'activo', activo,
      'creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto, 'link', hash is not null) order by creado) from cb_sup), '[]'::jsonb);
end $$;

create or replace function public.cb_sup_guardar(p_clave text, p_id text, p_nombre text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[];
begin
  perform cb_check(p_clave);
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('mp_ver','mp_solicitar','pt_ver','dev_ver','dev_crear')) then raise exception 'datos_invalidos'; end if;
  -- para crear hay que poder ver el módulo
  if 'mp_solicitar' = any(v_perm) and not ('mp_ver' = any(v_perm)) then v_perm := v_perm || 'mp_ver'::text; end if;
  if 'dev_crear' = any(v_perm) and not ('dev_ver' = any(v_perm)) then v_perm := v_perm || 'dev_ver'::text; end if;
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

-- Link nuevo: el anterior deja de servir y el equipo vinculado queda desconectado ("liberar").
create or replace function public.cb_sup_link(p_clave text, p_id text, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if length(coalesce(p_token,'')) < 16 then raise exception 'clave_corta'; end if;
  update cb_sup set hash = extensions.crypt(p_token, extensions.gen_salt('bf')), usado = null, sesion_hash = null, equipo = null, visto = null where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

create or replace function public.cb_sup_eliminar(p_clave text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  delete from cb_sup where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

-- ---------- Supervisor: abrir su link (una sola vez) y consultar sus permisos ----------
create or replace function public.cb_sup_vincular(p_id text, p_token text, p_equipo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s cb_sup; v_sec text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into s from cb_sup where id = p_id for update;
  if not found or s.hash is null or s.hash <> extensions.crypt(coalesce(p_token,''), s.hash) then perform pg_sleep(0.5); raise exception 'acceso_produccion'; end if;
  if not s.activo then raise exception 'usuario_inactivo'; end if;
  if s.usado is not null then raise exception 'prod_usado'; end if;
  update cb_sup set usado = now(), visto = now(), equipo = left(p_equipo, 120), sesion_hash = extensions.crypt(v_sec, extensions.gen_salt('bf')) where id = p_id;
  return jsonb_build_object('ses', s.id || '.' || v_sec, 'nombre', s.nombre, 'permisos', to_jsonb(s.permisos));
end $$;

create or replace function public.cb_sup_yo(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s cb_sup;
begin
  perform cb_puede(p_clave, '*');
  s := cb_sup_de(p_clave);
  if s.id is null then return jsonb_build_object('rol', cb_rol(p_clave)); end if;
  return jsonb_build_object('rol', 'sup', 'id', s.id, 'nombre', s.nombre, 'permisos', to_jsonb(s.permisos));
end $$;

-- ---------- Funciones del panel que ahora aceptan supervisores (según permiso) ----------
create or replace function public.cb_catalogo_ver(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, '*');
begin
  return (select jsonb_build_object('items', items, 'actualizado', actualizado, 'origen', origen) from cb_catalogo where id = 1);
end $$;

create or replace function public.cb_mov_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_ver');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'nombre', m.nombre, 'creado', m.creado, 'vence', m.vence, 'finalizado', m.finalizado, 'meta', m.meta, 'token', case when r = 'admin' then m.link_token end,
      'lados', coalesce((select jsonb_object_agg(l.rol, jsonb_build_object(
          'persona', l.persona, 'abierto', l.abierto, 'visto', l.visto, 'terminado', l.terminado,
          'ultimo_envio', l.ultimo_envio, 'n_lecturas', l.n_lecturas, 'bloqueado', l.device = '__bloqueado__')) from cb_mov_lado l where l.mov = m.id), '{}'::jsonb)
    ) order by m.creado desc)
    from cb_mov m where m.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

create or replace function public.cb_mov_lecturas(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_ver');
begin
  return coalesce((select jsonb_agg(data || jsonb_build_object('rol', rol) order by data->>'t') from cb_mov_lect where mov = p_id), '[]'::jsonb);
end $$;

-- Cerrar una entrega: el administrador (y el acceso antiguo) cuando quiera; un supervisor NO.
-- Excepción: el cierre automático cuando los dos lados ya terminaron, que no es una decisión.
create or replace function public.cb_mov_finalizar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_ver');
begin
  if r = 'sup' and (select count(*) from cb_mov_lado where mov = p_id and rol in ('E','R') and terminado is not null) < 2 then
    raise exception 'sin_permiso';
  end if;
  update cb_mov set finalizado = coalesce(finalizado, now()) where id = p_id;
end $$;

create or replace function public.cb_mov_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid; v_items jsonb := p_items; r text := cb_puede(p_clave, 'mp_solicitar'); v_nom text;
begin
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    select items into v_items from cb_catalogo where id = 1;
  end if;
  if v_items is null or jsonb_array_length(v_items) = 0 then raise exception 'sin_productos'; end if;
  if r in ('prod','sup') then
    -- Producción solo envía la SOLICITUD: bodega (administrador) la activa.
    if coalesce(jsonb_typeof(p_meta -> 'sol'), '') <> 'array' or jsonb_array_length(p_meta -> 'sol') = 0 then raise exception 'sin_productos'; end if;
    if r = 'sup' then v_nom := (cb_sup_de(p_clave)).nombre; end if;
    insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
    values (left(p_nombre, 120), null, extensions.crypt(encode(extensions.gen_random_bytes(16), 'hex'), extensions.gen_salt('bf')), null, v_items,
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('creado_por', r, 'estado', 'solicitada')
              || case when v_nom is not null then jsonb_build_object('creado_nombre', v_nom) else '{}'::jsonb end)
    returning id into v_id;
    return jsonb_build_object('id', v_id);
  end if;
  insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), v_token, v_items,
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('creado_por', r, 'estado', 'activa'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.cb_pt_listar(p_clave text, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'pt_ver');
begin
  return jsonb_build_object(
    'pallets', coalesce((select jsonb_agg(data || jsonb_build_object('puesto', case lado when 'E' then 'produccion' when 'D' then 'retail' else 'bodega' end,
        'usuario', puesto, 'pallet', pallet, 'rt', t) order by t) from cb_pt where t >= p_desde), '[]'::jsonb),
    'cierres', coalesce((select jsonb_agg(jsonb_build_object('puesto', case lado when 'E' then 'produccion' when 'D' then 'retail' else 'bodega' end,
        'usuario', puesto, 'persona', persona, 't', t) order by t) from cb_pt_cierre where t >= p_desde - interval '1 day'), '[]'::jsonb),
    'puestos', jsonb_build_object(
        'produccion', (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_entregar' = any(permisos)),
        'bodega',     (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_recibir' = any(permisos)),
        'retail',     (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_retirar' = any(permisos))),
    'usuarios', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'persona', persona, 'visto', visto, 'usado', usado,
        'lado', case when 'pt_entregar' = any(permisos) then 'produccion' when 'pt_retirar' = any(permisos) then 'retail' else 'bodega' end) order by visto desc nulls last)
      from cb_puesto where activo and permisos && array['pt_entregar','pt_recibir','pt_retirar']::text[]), '[]'::jsonb));
end $$;

-- Devoluciones: un supervisor solo ve las de Producción.
create or replace function public.cb_dev_listar(p_clave text, p_desde timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'dev_ver');
begin
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.creado desc) from cb_dev d
    where d.creado > coalesce(p_desde, now() - interval '120 days')
      and (r = 'admin' or d.area ilike 'producci_n%')), '[]'::jsonb);
end $$;

-- Crear devolución desde el panel: la de un supervisor siempre queda en Producción y a su nombre.
create or replace function public.cb_dev_crear_panel(p_clave text, p_area text, p_doc jsonb, p_lect jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_fecha date; r text := cb_puede(p_clave, 'dev_crear'); v_area text := p_area; v_pers text := p_doc->>'persona';
begin
  if r = 'sup' then v_area := 'Producción'; v_pers := (cb_sup_de(p_clave)).nombre; end if;
  if p_lect is null or jsonb_typeof(p_lect) <> 'array' or jsonb_array_length(p_lect) = 0 then raise exception 'sin_productos'; end if;
  if jsonb_array_length(p_lect) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_lect);
  if coalesce(trim(p_doc->>'guia'),'') = '' and coalesce(trim(p_doc->>'factura'),'') = '' then raise exception 'falta_documento'; end if;
  begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then raise exception 'fecha_invalida'; end;
  if v_fecha is null then raise exception 'fecha_invalida'; end if;
  insert into cb_dev(origen, area, persona, guia, factura, fecha, nota, lect, enviado)
  values ('panel', left(coalesce(nullif(trim(v_area),''), 'Panel'), 60), left(v_pers, 80), left(trim(p_doc->>'guia'), 40), left(trim(p_doc->>'factura'), 40),
          v_fecha, left(p_doc->>'nota', 300), p_lect, now())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

revoke all on function public.cb_sup_listar(text), public.cb_sup_guardar(text, text, text, jsonb, boolean), public.cb_sup_link(text, text, text),
  public.cb_sup_eliminar(text, text), public.cb_sup_vincular(text, text, text), public.cb_sup_yo(text) from public;
grant execute on function public.cb_sup_listar(text), public.cb_sup_guardar(text, text, text, jsonb, boolean), public.cb_sup_link(text, text, text),
  public.cb_sup_eliminar(text, text), public.cb_sup_vincular(text, text, text), public.cb_sup_yo(text) to anon, authenticated;
