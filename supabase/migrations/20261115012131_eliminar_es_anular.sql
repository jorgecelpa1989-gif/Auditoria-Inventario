-- =====================================================================
--  ELIMINAR → ANULAR (Entrega MP, Recepción de proveedores, Devoluciones)
--  Nada se borra: "Eliminar" ahora anula. Lo anulado deja de verse en las listas, los celulares y los
--  Excel, no se puede modificar (lo bloquea el servidor) y se puede restaurar desde «Anuladas».
--  Compatible con la app anterior: su botón «Eliminar» pasa a anular y sus listas ya no muestran lo anulado.
-- =====================================================================
alter table public.cb_mov  add column if not exists anulado timestamptz, add column if not exists anulado_por text;
alter table public.cb_prov add column if not exists anulado timestamptz, add column if not exists anulado_por text;
alter table public.cb_dev  add column if not exists anulado timestamptz, add column if not exists anulado_por text;

-- Lo anulado no se modifica (solo se puede restaurar). Cubre todas las funciones que escriben.
create or replace function public.cb_anulado_bloquea() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.anulado is not null and new.anulado is not null then raise exception 'anulado'; end if;
  return new;
end $$;
create or replace function public.cb_mov_hijo_bloquea() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from cb_mov where id = coalesce(case when tg_op = 'DELETE' then null else new.mov end, old.mov) and anulado is not null) then raise exception 'anulado'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.cb_anulado_bloquea(), public.cb_mov_hijo_bloquea() from public, anon, authenticated;
drop trigger if exists cb_mov_anulado on public.cb_mov;
create trigger cb_mov_anulado before update on public.cb_mov for each row execute function public.cb_anulado_bloquea();
drop trigger if exists cb_prov_anulado on public.cb_prov;
create trigger cb_prov_anulado before update on public.cb_prov for each row execute function public.cb_anulado_bloquea();
drop trigger if exists cb_dev_anulado on public.cb_dev;
create trigger cb_dev_anulado before update on public.cb_dev for each row execute function public.cb_anulado_bloquea();
drop trigger if exists cb_mov_lado_anulado on public.cb_mov_lado;
create trigger cb_mov_lado_anulado before insert or update or delete on public.cb_mov_lado for each row execute function public.cb_mov_hijo_bloquea();
drop trigger if exists cb_mov_lect_anulado on public.cb_mov_lect;
create trigger cb_mov_lect_anulado before insert or update or delete on public.cb_mov_lect for each row execute function public.cb_mov_hijo_bloquea();

create or replace function public.cb_mov_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin   -- ya no borra: anula (deja de verse en listas y celulares; se puede restaurar)
  perform cb_puede(p_clave, 'mp_eliminar');
  update cb_mov set anulado = now(), anulado_por = left(coalesce(cb_sup_nombre(p_clave), 'Administrador'), 80) where id = p_id and anulado is null;
end $$;
create or replace function public.cb_mov_restaurar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'mp_eliminar');
  update cb_mov set anulado = null, anulado_por = null where id = p_id and anulado is not null;
  if not found then raise exception 'no_existe'; end if;
end $$;
create or replace function public.cb_prov_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin   -- ya no borra: anula (deja de verse en listas y celulares; se puede restaurar)
  perform cb_puede(p_clave, 'prov_eliminar');
  update cb_prov set anulado = now(), anulado_por = left(coalesce(cb_sup_nombre(p_clave), 'Administrador'), 80) where id = p_id and anulado is null;
end $$;
create or replace function public.cb_prov_restaurar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'prov_eliminar');
  update cb_prov set anulado = null, anulado_por = null where id = p_id and anulado is not null;
  if not found then raise exception 'no_existe'; end if;
end $$;
create or replace function public.cb_dev_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin   -- ya no borra: anula (deja de verse en listas y celulares; se puede restaurar)
  perform cb_puede(p_clave, 'dev_eliminar');
  update cb_dev set anulado = now(), anulado_por = left(coalesce(cb_sup_nombre(p_clave), 'Administrador'), 80) where id = p_id and anulado is null;
end $$;
create or replace function public.cb_dev_restaurar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'dev_eliminar');
  update cb_dev set anulado = null, anulado_por = null where id = p_id and anulado is not null;
  if not found then raise exception 'no_existe'; end if;
end $$;

-- Lo anulado (últimos 120 días), para la sección «Anuladas» del panel
create or replace function public.cb_mov_anulados(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_ver');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'creado', m.creado, 'meta', m.meta, 'anulado', m.anulado, 'anulado_por', m.anulado_por,
      'n', (select count(*) from cb_mov_lect l where l.mov = m.id)) order by m.anulado desc)
    from cb_mov m where m.anulado is not null and m.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;
create or replace function public.cb_prov_anulados(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'prov_ver');
begin
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.anulado desc) from cb_prov p
    where p.anulado is not null and p.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;
create or replace function public.cb_dev_anulados(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'dev_ver'); v_todas boolean;
begin
  v_todas := r = 'admin' or cb_sup_tiene(p_clave, 'dev_todas');
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.anulado desc) from cb_dev d
    where d.anulado is not null and d.creado > now() - interval '120 days' and (v_todas or d.area ilike 'producci_n%')), '[]'::jsonb);
end $$;

-- Listas del panel y de los celulares: sin lo anulado
CREATE OR REPLACE FUNCTION public.cb_mov_listar(p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r text := cb_puede(p_clave, 'mp_ver');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'nombre', m.nombre, 'creado', m.creado, 'vence', m.vence, 'finalizado', m.finalizado, 'meta', m.meta, 'token', case when r = 'admin' then m.link_token end,
      'lados', coalesce((select jsonb_object_agg(l.rol, jsonb_build_object(
          'persona', l.persona, 'abierto', l.abierto, 'visto', l.visto, 'terminado', l.terminado,
          'ultimo_envio', l.ultimo_envio, 'n_lecturas', l.n_lecturas, 'bloqueado', l.device = '__bloqueado__')) from cb_mov_lado l where l.mov = m.id), '{}'::jsonb)
    ) order by m.creado desc)
    from cb_mov m where m.creado > now() - interval '120 days' and m.anulado is null), '[]'::jsonb);
end $function$;
CREATE OR REPLACE FUNCTION public.cb_prov_listar(p_clave text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r text := cb_puede(p_clave, 'prov_ver');
begin
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.creado desc) from cb_prov p
    where p.creado > coalesce(p_desde, now() - interval '120 days') and p.anulado is null), '[]'::jsonb);
end $function$;
CREATE OR REPLACE FUNCTION public.cb_dev_listar(p_clave text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare r text := cb_puede(p_clave, 'dev_ver'); v_todas boolean;
begin
  v_todas := r = 'admin' or cb_sup_tiene(p_clave, 'dev_todas');
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.creado desc) from cb_dev d
    where d.creado > coalesce(p_desde, now() - interval '120 days') and d.anulado is null
      and (v_todas or d.area ilike 'producci_n%')), '[]'::jsonb);
end $function$;
CREATE OR REPLACE FUNCTION public.cb_dev_mis(p_puesto text, p_ses text, p_modo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_rec boolean;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  v_rec := case p_modo when 'rec' then true when 'carga' then false else cb_u_tiene(p_puesto, 'dev_recibir') end;
  if v_rec then
    if not cb_u_tiene(p_puesto, 'dev_recibir') then return '[]'::jsonb; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'origen', d.origen, 'area', d.area, 'persona', d.persona, 'guia', d.guia, 'factura', d.factura,
        'fecha', d.fecha, 'nota', d.nota, 'enviado', d.enviado, 'lect', d.lect, 'rec', d.rec, 'rec_persona', d.rec_persona, 'rec_inicio', d.rec_inicio, 'recibido', d.recibido) order by d.enviado)
      from cb_dev d where d.anulado is null and d.enviado is not null and d.finalizado is null and (d.recibido is null or d.recibido > now() - interval '18 hours')), '[]'::jsonb);
  end if;
  if not cb_u_tiene(p_puesto, 'dev_cargar') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'area', d.area, 'persona', d.persona, 'guia', d.guia, 'factura', d.factura, 'fecha', d.fecha, 'nota', d.nota,
      'creado', d.creado, 'enviado', d.enviado, 'lect', d.lect, 'rec_inicio', d.rec_inicio, 'recibido', d.recibido, 'finalizado', d.finalizado) order by d.creado desc)
    from cb_dev d where d.anulado is null and d.origen = p_puesto and d.creado > now() - interval '30 days'), '[]'::jsonb);
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
      'rec_persona', p.rec_persona, 'rec_inicio', p.rec_inicio, 'recibido', p.recibido) order by p.creado)
    from cb_prov p where p.anulado is null and p.finalizado is null and (p.recibido is null or p.recibido > now() - interval '18 hours')), '[]'::jsonb);
end $function$;
CREATE OR REPLACE FUNCTION public.cb_puesto_tareas(p_puesto text, p_ses text, p_persona text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
            from cb_mov m where m.anulado is null and coalesce(m.meta->>'estado','activa') = 'activa' and m.meta->>'puestos' = 'true' and m.finalizado is null
              and m.link_token is not null and (m.vence is null or m.vence > now())), '[]'::jsonb) end,
    'conteos', case when 'conteo' = any(a.permisos) then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'token', c.link_token,
              'creado', c.creado, 'vence', c.vence, 'productos', jsonb_array_length(c.items), 'terminado', c.terminado) order by c.creado)
            from cb_conteos c where c.puesto = p_puesto and c.finalizado is null and c.link_token is not null and (c.vence is null or c.vence > now())), '[]'::jsonb)
            else '[]'::jsonb end,
    'pt_cierre', (select max(t) from cb_pt_cierre where puesto = p_puesto));
end $function$;
CREATE OR REPLACE FUNCTION public.cb_mov_abrir(p_id uuid, p_token text, p_device text, p_rol text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare m cb_mov; l cb_mov_lado; v_secret text := encode(extensions.gen_random_bytes(16), 'hex'); v_mio text; v_stock jsonb; v_at timestamptz;
begin
  select * into m from cb_mov where id = p_id;
  if not found or m.token_hash <> extensions.crypt(coalesce(p_token,''), m.token_hash) then
    perform pg_sleep(0.5); raise exception 'no_existe';
  end if;
  if coalesce(m.meta ->> 'estado', 'activa') = 'solicitada' then perform pg_sleep(0.5); raise exception 'no_existe'; end if;
  if m.anulado is not null then raise exception 'anulado'; end if;
  if m.finalizado is not null then raise exception 'finalizado'; end if;
  if m.vence is not null and m.vence < now() then raise exception 'vencido'; end if;
  select rol into v_mio from cb_mov_lado where mov = p_id and device = p_device limit 1;
  if p_rol is null then
    return jsonb_build_object('nombre', m.nombre, 'meta', m.meta, 'mio', v_mio,
      'tomados', coalesce((select jsonb_object_agg(rol, coalesce(persona,'')) from cb_mov_lado where mov = p_id), '{}'::jsonb));
  end if;
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  if v_mio is not null and v_mio <> p_rol then raise exception 'otro_rol'; end if;
  select * into l from cb_mov_lado where mov = p_id and rol = p_rol for update;
  if found and l.device = '__bloqueado__' then raise exception 'bloqueado'; end if;
  if found and l.device <> p_device then raise exception 'rol_tomado'; end if;
  if found then
    update cb_mov_lado set secret_hash = extensions.crypt(v_secret, extensions.gen_salt('bf')), visto = now(), terminado = null where mov = p_id and rol = p_rol;
  else
    insert into cb_mov_lado(mov, rol, device, secret_hash, visto) values (p_id, p_rol, p_device, extensions.crypt(v_secret, extensions.gen_salt('bf')), now());
  end if;
  if p_rol = 'E' then
    select c.actualizado,
           (select jsonb_object_agg(k, c.stock -> k) from (select s ->> 0 as k from jsonb_array_elements(coalesce(m.meta -> 'sol', '[]'::jsonb)) s) q where c.stock ? k)
      into v_at, v_stock from cb_catalogo c where c.id = 1;
  end if;
  return jsonb_build_object('nombre', m.nombre, 'creado', m.creado, 'vence', m.vence, 'items', m.items, 'meta', m.meta, 'secret', v_secret, 'rol', p_rol,
    'stock', v_stock, 'stock_at', v_at,
    'lect', coalesce((select jsonb_agg(data order by data->>'t') from cb_mov_lect where mov = p_id and rol = p_rol), '[]'::jsonb));
end $function$;

grant execute on function public.cb_mov_restaurar(text, uuid), public.cb_prov_restaurar(text, uuid), public.cb_dev_restaurar(text, uuid),
  public.cb_mov_anulados(text), public.cb_prov_anulados(text), public.cb_dev_anulados(text) to anon, authenticated;
