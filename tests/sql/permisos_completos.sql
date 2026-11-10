-- =====================================================================
--  Actualización 18 · Supervisores: todos los módulos, permisos a elección del administrador
--  El administrador marca, para cada supervisor, qué puede hacer en cada módulo:
--    Inventario     inv_ver · inv_operar (crear, modificar, asignar, finalizar conteos, cargar ERP)
--    Entrega MP     mp_ver · mp_solicitar · mp_operar (activar, extender, asignar, cerrar, liberar/bloquear) · mp_eliminar
--    Recepción PT   pt_ver · pt_corregir (corregir, anular y agregar registros)
--    Devoluciones   dev_ver · dev_crear · dev_todas (todas las áreas, no solo Producción) · dev_cerrar · dev_eliminar
--    Usuarios       usr_admin (crear, editar, liberar y eliminar usuarios de celulares)
--  Solo el administrador (su clave): supervisores y sus permisos, acceso antiguo de producción, configuración
--  y eliminar conteos (cb_eliminar no cambia).
--  También: eliminar el acceso antiguo de producción (cb_prod_eliminar).
-- =====================================================================

-- p_perm puede traer varias opciones separadas por "|" (basta con tener una). '*' = cualquier supervisor activo.
create or replace function public.cb_puede(p_clave text, p_perm text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare s cb_sup; r text; v_op text[] := string_to_array(p_perm, '|');
begin
  if coalesce(p_clave,'') like 's\_%.%' then
    s := cb_sup_de(p_clave);
    if s.id is null then perform pg_sleep(0.5); raise exception 'acceso_produccion'; end if;
    if not s.activo then raise exception 'usuario_inactivo'; end if;
    if p_perm <> '*' and not (s.permisos && v_op) then raise exception 'sin_permiso'; end if;
    update cb_sup set visto = now() where id = s.id;
    return 'sup';
  end if;
  r := cb_rol(p_clave);                                  -- admin o acceso antiguo de producción (o error)
  if r = 'prod' and p_perm <> '*' and not (v_op && array['mp_ver','mp_solicitar','pt_ver']) then raise exception 'sin_permiso'; end if;
  return r;
end $$;

-- ¿Este supervisor tiene el permiso? (falso si la clave no es de un supervisor)
create or replace function public.cb_sup_tiene(p_clave text, p_perm text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare s cb_sup;
begin
  if coalesce(p_clave,'') not like 's\_%.%' then return false; end if;
  s := cb_sup_de(p_clave);
  return s.id is not null and s.activo and p_perm = any(s.permisos);
end $$;

-- Nombre del supervisor que llama (nulo si es el administrador): para dejar anotado quién hizo cada cambio.
create or replace function public.cb_sup_nombre(p_clave text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(p_clave,'') not like 's\_%.%' then return null; end if;
  return (cb_sup_de(p_clave)).nombre;
end $$;

revoke execute on function public.cb_puede(text, text), public.cb_sup_tiene(text, text), public.cb_sup_nombre(text) from public, anon, authenticated;

create or replace function public.cb_sup_guardar(p_clave text, p_id text, p_nombre text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[]; par record;
begin
  perform cb_check(p_clave);
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('inv_ver','inv_operar','mp_ver','mp_solicitar','mp_operar','mp_eliminar',
      'pt_ver','pt_corregir','dev_ver','dev_crear','dev_todas','dev_cerrar','dev_eliminar','usr_admin')) then raise exception 'datos_invalidos'; end if;
  -- para operar o eliminar hay que poder ver el módulo
  for par in select * from (values ('inv_operar','inv_ver'),('mp_solicitar','mp_ver'),('mp_operar','mp_ver'),('mp_operar','mp_solicitar'),('mp_eliminar','mp_ver'),
      ('pt_corregir','pt_ver'),('dev_crear','dev_ver'),('dev_todas','dev_ver'),('dev_cerrar','dev_ver'),('dev_eliminar','dev_ver')) v(hijo, padre) loop
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

-- Eliminar el acceso antiguo de producción (el link único del jefe de producción): deja de funcionar al instante.
create or replace function public.cb_prod_eliminar(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  delete from cb_acceso where id = 'produccion';
end $$;
revoke all on function public.cb_prod_eliminar(text) from public;
grant execute on function public.cb_prod_eliminar(text) to anon, authenticated;

-- Cerrar una entrega: administrador, acceso antiguo o supervisor con "operar". Sin "operar", solo el cierre
-- automático cuando los dos lados ya terminaron.
create or replace function public.cb_mov_finalizar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_ver');
begin
  if r = 'sup' and not cb_sup_tiene(p_clave, 'mp_operar')
     and (select count(*) from cb_mov_lado where mov = p_id and rol in ('E','R') and terminado is not null) < 2 then
    raise exception 'sin_permiso';
  end if;
  update cb_mov set finalizado = coalesce(finalizado, now()) where id = p_id;
end $$;

-- Crear: con "operar" crea la entrega activa (como el administrador); con solo "solicitar", una solicitud.
create or replace function public.cb_mov_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid; v_items jsonb := p_items; r text := cb_puede(p_clave, 'mp_solicitar'); v_nom text;
begin
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    select items into v_items from cb_catalogo where id = 1;
  end if;
  if v_items is null or jsonb_array_length(v_items) = 0 then raise exception 'sin_productos'; end if;
  if r = 'sup' then v_nom := (cb_sup_de(p_clave)).nombre; end if;
  if r = 'prod' or (r = 'sup' and not cb_sup_tiene(p_clave, 'mp_operar')) then
    if coalesce(jsonb_typeof(p_meta -> 'sol'), '') <> 'array' or jsonb_array_length(p_meta -> 'sol') = 0 then raise exception 'sin_productos'; end if;
    insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
    values (left(p_nombre, 120), null, extensions.crypt(encode(extensions.gen_random_bytes(16), 'hex'), extensions.gen_salt('bf')), null, v_items,
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('creado_por', r, 'estado', 'solicitada')
              || case when v_nom is not null then jsonb_build_object('creado_nombre', v_nom) else '{}'::jsonb end)
    returning id into v_id;
    return jsonb_build_object('id', v_id);
  end if;
  insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), v_token, v_items,
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('creado_por', r, 'estado', 'activa')
            || case when v_nom is not null then jsonb_build_object('creado_nombre', v_nom) else '{}'::jsonb end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Devoluciones: sin "todas las áreas", un supervisor solo ve y crea las de Producción.
create or replace function public.cb_dev_listar(p_clave text, p_desde timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'dev_ver'); v_todas boolean;
begin
  v_todas := r = 'admin' or cb_sup_tiene(p_clave, 'dev_todas');
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.creado desc) from cb_dev d
    where d.creado > coalesce(p_desde, now() - interval '120 days')
      and (v_todas or d.area ilike 'producci_n%')), '[]'::jsonb);
end $$;

create or replace function public.cb_dev_crear_panel(p_clave text, p_area text, p_doc jsonb, p_lect jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_fecha date; r text := cb_puede(p_clave, 'dev_crear'); v_area text := p_area; v_pers text := p_doc->>'persona';
begin
  if r = 'sup' then
    v_pers := (cb_sup_de(p_clave)).nombre;
    if not cb_sup_tiene(p_clave, 'dev_todas') then v_area := 'Producción'; end if;
  end if;
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

-- El resto de las funciones del panel: misma lógica de siempre; solo cambia quién puede llamarlas.
create or replace function public.cb_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_ver');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'finalizado', c.finalizado,
      'abierto', c.abierto, 'contador', c.contador, 'ultimo_envio', c.ultimo_envio, 'n_lecturas', c.n_lecturas,
      'visto', c.visto, 'terminado', c.terminado, 'puesto', c.puesto, 'asignable', c.link_token is not null,
      'libre', c.device is null, 'bloqueado', c.device = '__bloqueado__', 'token', c.link_token,
      'productos', jsonb_array_length(c.items),
      'contados', (select count(distinct l.data->>'k') from cb_lecturas l where l.conteo = c.id)
    ) order by c.creado desc)
    from cb_conteos c where c.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

create or replace function public.cb_lecturas_de(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_ver');
  return coalesce((select jsonb_agg(data order by data->>'t') from cb_lecturas where conteo = p_id), '[]'::jsonb);
end $$;

create or replace function public.cb_conteo_codigos(p_clave text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_ver');
  if p_ids is null or array_length(p_ids, 1) is null then return '{}'::jsonb; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'datos_invalidos'; end if;
  return coalesce((select jsonb_object_agg(c.id::text, jsonb_build_object(
      'codes', (select coalesce(jsonb_agg(e->>0), '[]'::jsonb) from jsonb_array_elements(c.items) e),
      'meta', c.meta))
    from cb_conteos c where c.id = any(p_ids)), '{}'::jsonb);
end $$;

create or replace function public.cb_catalogo_stock(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_ver');
  return (select jsonb_build_object('items', items, 'stock', stock, 'origen', origen, 'actualizado', actualizado) from cb_catalogo where id = 1);
end $$;

create or replace function public.cb_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid;
begin
  perform cb_puede(p_clave, 'inv_operar');
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'sin_productos'; end if;
  insert into cb_conteos(nombre, vence, token_hash, link_token, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), v_token, p_items, p_meta)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.cb_conteo_editar(p_clave text, p_id uuid, p_nombre text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos; v_add jsonb; v_nom text;
begin
  perform cb_puede(p_clave, 'inv_operar');
  select * into c from cb_conteos where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if c.finalizado is not null then raise exception 'finalizado'; end if;
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then raise exception 'datos_invalidos'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 20000 then raise exception 'datos_invalidos'; end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_add
    from (select distinct on (lower(e->>0)) e from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
           where jsonb_typeof(e) = 'array' and coalesce(e->>0, '') <> ''
             and not exists (select 1 from jsonb_array_elements(c.items) x where lower(x->>0) = lower(e->>0))) s;
  v_nom := coalesce(nullif(left(trim(coalesce(p_nombre, '')), 120), ''), c.nombre);
  if v_nom = c.nombre and jsonb_array_length(v_add) = 0 then
    return jsonb_build_object('nombre', c.nombre, 'productos', jsonb_array_length(c.items), 'agregados', 0);
  end if;
  update cb_conteos set nombre = v_nom, items = items || v_add, editado = now() where id = p_id;
  return jsonb_build_object('nombre', v_nom, 'productos', jsonb_array_length(c.items) + jsonb_array_length(v_add), 'agregados', jsonb_array_length(v_add));
end $$;

create or replace function public.cb_conteo_asignar(p_clave text, p_id uuid, p_puesto text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_operar');
  if nullif(p_puesto, '') is not null and not cb_u_tiene(p_puesto, 'conteo') then raise exception 'sin_permiso'; end if;
  update cb_conteos set puesto = nullif(p_puesto, '') where id = p_id;
end $$;

create or replace function public.cb_finalizar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_operar');
  update cb_conteos set finalizado = coalesce(finalizado, now()) where id = p_id;
end $$;

create or replace function public.cb_bloquear(p_clave text, p_id uuid, p_si boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_operar');
  if p_si then update cb_conteos set device = '__bloqueado__', secret_hash = null where id = p_id;
  else update cb_conteos set device = null, secret_hash = null where id = p_id and device = '__bloqueado__'; end if;
end $$;

create or replace function public.cb_liberar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_fin timestamptz;
begin
  perform cb_puede(p_clave, 'inv_operar');
  select finalizado into v_fin from cb_conteos where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if v_fin is not null then raise exception 'finalizado'; end if;
  update cb_conteos set device = null, secret_hash = null, terminado = null where id = p_id;
end $$;

create or replace function public.cb_catalogo_subir(p_clave text, p_items jsonb, p_stock jsonb, p_origen text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_operar');
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'sin_productos'; end if;
  insert into cb_catalogo(id, items, stock, origen, actualizado) values (1, p_items, p_stock, left(p_origen, 200), now())
  on conflict (id) do update set items = excluded.items, stock = excluded.stock, origen = excluded.origen, actualizado = now();
end $$;

create or replace function public.cb_mov_activar(p_clave text, p_id uuid, p_vence timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  perform cb_puede(p_clave, 'mp_operar');
  update cb_mov set token_hash = extensions.crypt(v_token, extensions.gen_salt('bf')), link_token = v_token, vence = p_vence,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('estado', 'activa', 'activada', now())
   where id = p_id and finalizado is null;
  if not found then raise exception 'no_existe'; end if;
  return jsonb_build_object('id', p_id, 'token', v_token);
end $$;

create or replace function public.cb_mov_extender(p_clave text, p_id uuid, p_vence timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'mp_operar');
  if p_vence is null or p_vence <= now() then raise exception 'datos_invalidos'; end if;
  update cb_mov set vence = p_vence
   where id = p_id and finalizado is null and coalesce(meta->>'estado', 'activa') = 'activa';
  if not found then raise exception 'no_existe'; end if;
  return jsonb_build_object('id', p_id, 'vence', p_vence);
end $$;

create or replace function public.cb_mov_asignar(p_clave text, p_id uuid, p_si boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'mp_operar');
  update cb_mov set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('puestos', p_si) where id = p_id;
end $$;

create or replace function public.cb_mov_bloquear(p_clave text, p_id uuid, p_rol text, p_si boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'mp_operar');
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  if p_si then
    insert into cb_mov_lado(mov, rol, device, secret_hash) values (p_id, p_rol, '__bloqueado__', extensions.crypt(encode(extensions.gen_random_bytes(16),'hex'), extensions.gen_salt('bf')))
    on conflict (mov, rol) do update set device = '__bloqueado__', secret_hash = excluded.secret_hash;
  else
    delete from cb_mov_lado where mov = p_id and rol = p_rol and device = '__bloqueado__';
  end if;
end $$;

create or replace function public.cb_mov_liberar(p_clave text, p_id uuid, p_rol text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'mp_operar');
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  if exists (select 1 from cb_mov where id = p_id and finalizado is not null) then raise exception 'finalizado'; end if;
  delete from cb_mov_lado where mov = p_id and rol = p_rol;
end $$;

create or replace function public.cb_mov_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'mp_eliminar');
  delete from cb_mov where id = p_id;
end $$;

create or replace function public.cb_pt_editar_panel(p_clave text, p_lid text, p_qty numeric, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'pt_corregir');
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  update cb_pt set data = data || jsonb_build_object('qty', p_qty, 'ed', coalesce(data->'ed', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object('de', data->'qty', 'a', p_qty, 'por', left(coalesce(cb_sup_nombre(p_clave), p_persona, 'Supervisor'), 80), 't', now(), 'via', 'panel')))
   where lid = p_lid;
  if not found then raise exception 'no_existe'; end if;
  return (select data from cb_pt where lid = p_lid);
end $$;

create or replace function public.cb_pt_agregar_panel(p_clave text, p_dia date, p_hora text, p_lado text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_t timestamptz; v_lid text; v_puesto text;
begin
  perform cb_puede(p_clave, 'pt_corregir');
  if p_lado not in ('E','R','D') then raise exception 'datos_invalidos'; end if;
  if p_dia is null or p_dia > (now() at time zone 'America/Santiago')::date then raise exception 'fecha_invalida'; end if;
  if coalesce(p_data->>'code','') = '' or coalesce((p_data->>'qty')::numeric, 0) <= 0 then raise exception 'datos_invalidos'; end if;
  v_t := (p_dia + coalesce(nullif(p_hora,'')::time, time '12:00')) at time zone 'America/Santiago';
  if v_t > now() then v_t := now(); end if;
  v_lid := 'man-' || encode(extensions.gen_random_bytes(8), 'hex');
  v_puesto := case p_lado when 'E' then 'panel_prod' when 'D' then 'panel_retail' else 'panel_bodega' end;
  insert into cb_pt(lid, puesto, pallet, data, t, lado)
  values (v_lid, v_puesto, upper(left(coalesce(nullif(p_data->>'pallet',''), 'SN-' || v_lid), 60)),
          p_data || jsonb_build_object('lid', v_lid, 't', v_t, 'manual', jsonb_build_object('por', coalesce(cb_sup_nombre(p_clave), p_data->>'user', 'Supervisor'), 'at', now(), 'via', 'panel')), v_t, p_lado);
  return jsonb_build_object('lid', v_lid, 't', v_t);
end $$;

create or replace function public.cb_dev_cerrar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'dev_cerrar');
  update cb_dev set finalizado = coalesce(finalizado, now()), actualizado = now() where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

create or replace function public.cb_dev_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'dev_eliminar');
  delete from cb_dev where id = p_id;
end $$;

create or replace function public.cb_u_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'usr_admin|inv_operar|mp_operar');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'area', area, 'permisos', to_jsonb(permisos), 'activo', activo,
      'creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto, 'persona', persona) order by creado) from cb_puesto), '[]'::jsonb);
end $$;

create or replace function public.cb_puesto_estado(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'usr_admin|inv_operar|mp_operar');
  return coalesce((select jsonb_object_agg(id, jsonb_build_object('creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto, 'persona', persona,
      'nombre', nombre, 'area', area, 'permisos', to_jsonb(permisos), 'activo', activo)) from cb_puesto), '{}'::jsonb);
end $$;

create or replace function public.cb_u_guardar(p_clave text, p_id text, p_nombre text, p_area text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[];
begin
  perform cb_puede(p_clave, 'usr_admin');
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

create or replace function public.cb_u_liberar(p_clave text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'usr_admin');
  update cb_puesto set usado = null, sesion_hash = null, equipo = null where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

create or replace function public.cb_u_eliminar(p_clave text, p_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'usr_admin');
  update cb_conteos set puesto = null where puesto = p_id;
  delete from cb_puesto where id = p_id;
end $$;

create or replace function public.cb_puesto_link(p_clave text, p_puesto text, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'usr_admin');
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
