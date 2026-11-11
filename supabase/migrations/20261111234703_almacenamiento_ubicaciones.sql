-- =====================================================================
--  Actualización 22 · Almacenamiento y ubicaciones (módulo 8)
--  El panel carga las ubicaciones de la bodega (pasillo, rack, nivel). El operario de bodega
--  (permiso de usuario "ubic_mover") registra desde el celular cada movimiento:
--    · ingreso  : llega producto a una ubicación
--    · traslado : pasa de una ubicación a otra
--    · salida   : sale de la ubicación (despacho o consumo)
--  El stock de cada ubicación es la suma de sus movimientos (no se guarda aparte: siempre cuadra).
--  Una salida o traslado no puede sacar más de lo que hay en la ubicación.
--  Permisos de supervisor: ubi_ver · ubi_operar.
--  Solo agrega cosas: la app anterior sigue funcionando igual.
-- =====================================================================

create table if not exists public.cb_ubic (
  cod      text primary key,                 -- código de la ubicación (ej. A-01-2)
  pasillo  text,
  rack     text,
  nivel    text,
  pos      text,
  tipo     text,                             -- rack, piso, cámara… (libre)
  nota     text,
  orden    int,
  activo   boolean not null default true,
  creado   timestamptz not null default now()
);
alter table public.cb_ubic enable row level security;
revoke all on public.cb_ubic from public, anon, authenticated;

create table if not exists public.cb_ubic_mov (
  id          uuid primary key default gen_random_uuid(),
  lid         text unique,                   -- id del celular: reenviar no duplica
  t           timestamptz not null default now(),
  tipo        text not null check (tipo in ('ingreso','traslado','salida')),
  desde       text,
  hacia       text,
  k           text not null,
  descr       text,
  qty         numeric not null check (qty > 0),   -- en bultos
  f           numeric not null default 1 check (f > 0),
  ce          text,
  um          text,
  persona     text,
  origen      text not null,                 -- usuario (celular) o 'panel'
  nota        text,
  anulado     timestamptz,
  anulado_por text
);
create index if not exists cb_ubic_mov_t_idx on public.cb_ubic_mov (t desc);
create index if not exists cb_ubic_mov_desde_idx on public.cb_ubic_mov (desde, k) where anulado is null;
create index if not exists cb_ubic_mov_hacia_idx on public.cb_ubic_mov (hacia, k) where anulado is null;
alter table public.cb_ubic_mov enable row level security;
revoke all on public.cb_ubic_mov from public, anon, authenticated;

-- Stock (en la unidad del ERP) de un producto en una ubicación.
create or replace function public.cb_ubic_hay(p_u text, p_k text) returns numeric
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(sum(case when hacia = p_u then qty * f else 0 end) - sum(case when desde = p_u then qty * f else 0 end), 0)
    from cb_ubic_mov where anulado is null and k = p_k and (hacia = p_u or desde = p_u)
$$;

-- Stock de todas las ubicaciones: [{u, k, base, f, ce, um, descr, ult}]
create or replace function public.cb_ubic_stock_json() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with m as (
    select hacia u, k, qty * f b, f, ce, um, descr, t from cb_ubic_mov where anulado is null and hacia is not null
    union all
    select desde, k, -qty * f, f, ce, um, descr, t from cb_ubic_mov where anulado is null and desde is not null)
  select coalesce(jsonb_agg(jsonb_build_object('u', u, 'k', k, 'base', base, 'f', f, 'ce', ce, 'um', um, 'descr', descr, 'ult', ult) order by u, k), '[]'::jsonb)
    from (select u, k, sum(b) base, (array_agg(f order by t desc))[1] f, (array_agg(ce order by t desc))[1] ce,
                 (array_agg(um order by t desc))[1] um, (array_agg(descr order by t desc))[1] descr, max(t) ult
            from m group by u, k having abs(sum(b)) > 1e-9) s
$$;

-- Registra un movimiento (uso interno: lo llaman el celular y el panel).
create or replace function public.cb_ubic_registrar(p_mov jsonb, p_origen text, p_persona text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_tipo text := p_mov->>'tipo'; v_desde text := nullif(upper(trim(coalesce(p_mov->>'desde',''))), '');
        v_hacia text := nullif(upper(trim(coalesce(p_mov->>'hacia',''))), ''); v_k text := nullif(trim(coalesce(p_mov->>'k', p_mov->>'code', '')), '');
        v_qty numeric; v_f numeric; v_lid text := nullif(left(p_mov->>'lid', 40), ''); v_id uuid; v_hay numeric;
begin
  if v_lid is not null then
    select id into v_id from cb_ubic_mov where lid = v_lid;
    if found then return jsonb_build_object('id', v_id, 'repetido', true); end if;   -- reenvío del mismo movimiento
  end if;
  if v_tipo is null or v_tipo not in ('ingreso','traslado','salida') then raise exception 'datos_invalidos'; end if;
  if v_k is null or length(v_k) > 40 then raise exception 'datos_invalidos'; end if;
  begin v_qty := (p_mov->>'qty')::numeric; v_f := coalesce(nullif(p_mov->>'f','')::numeric, 1); exception when others then raise exception 'datos_invalidos'; end;
  if v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_f <= 0 or v_f > 100000 then raise exception 'cantidad_invalida'; end if;
  if v_tipo = 'ingreso' then v_desde := null; if v_hacia is null then raise exception 'falta_ubicacion'; end if; end if;
  if v_tipo = 'salida' then v_hacia := null; if v_desde is null then raise exception 'falta_ubicacion'; end if; end if;
  if v_tipo = 'traslado' then
    if v_desde is null or v_hacia is null then raise exception 'falta_ubicacion'; end if;
    if v_desde = v_hacia then raise exception 'misma_ubicacion'; end if;
  end if;
  if v_desde is not null and not exists (select 1 from cb_ubic where cod = v_desde and activo) then raise exception 'ubicacion_no_existe'; end if;
  if v_hacia is not null and not exists (select 1 from cb_ubic where cod = v_hacia and activo) then raise exception 'ubicacion_no_existe'; end if;
  if v_desde is not null then
    perform pg_advisory_xact_lock(hashtext('cb_ubic:' || v_desde));          -- dos celulares no sacan lo mismo a la vez
    v_hay := cb_ubic_hay(v_desde, v_k);
    if v_qty * v_f > v_hay + 1e-9 then raise exception 'sin_stock'; end if;
  end if;
  insert into cb_ubic_mov(lid, tipo, desde, hacia, k, descr, qty, f, ce, um, persona, origen, nota)
  values (v_lid, v_tipo, v_desde, v_hacia, v_k, left(p_mov->>'desc', 120), v_qty, v_f, left(nullif(p_mov->>'ce',''), 20), left(p_mov->>'um', 10),
          left(p_persona, 80), left(p_origen, 40), left(p_mov->>'nota', 200))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
revoke execute on function public.cb_ubic_hay(text, text), public.cb_ubic_stock_json(), public.cb_ubic_registrar(jsonb, text, text) from public, anon, authenticated;

-- ---------- Panel ----------
create or replace function public.cb_ubic_datos(p_clave text, p_dias int default 30) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'ubi_ver');
begin
  return jsonb_build_object(
    'ubic', coalesce((select jsonb_agg(to_jsonb(u) order by u.orden nulls last, u.cod) from cb_ubic u where u.activo), '[]'::jsonb),
    'stock', cb_ubic_stock_json(),
    'movs', coalesce((select jsonb_agg(to_jsonb(m) order by m.t desc) from (select * from cb_ubic_mov
               where t > now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 400)) order by t desc limit 3000) m), '[]'::jsonb));
end $$;

-- Carga las ubicaciones. Con p_reemplazar, las que no vienen en la lista quedan inactivas (su historial se conserva).
create or replace function public.cb_ubic_guardar(p_clave text, p_lista jsonb, p_reemplazar boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'ubi_operar'); n int; v_ocup int;
begin
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' or jsonb_array_length(p_lista) > 20000 then raise exception 'datos_invalidos'; end if;
  if exists (select 1 from jsonb_array_elements(p_lista) e where jsonb_typeof(e) <> 'object' or coalesce(trim(e->>'cod'), '') = '' or length(e->>'cod') > 40) then
    raise exception 'datos_invalidos'; end if;
  if p_reemplazar then
    -- no se puede desactivar una ubicación que todavía tiene producto
    select count(*) into v_ocup from (select distinct x->>'u' u from jsonb_array_elements(cb_ubic_stock_json()) x where (x->>'base')::numeric > 1e-9) s
     where s.u not in (select upper(trim(e->>'cod')) from jsonb_array_elements(p_lista) e);
    if v_ocup > 0 then raise exception 'ubicacion_con_stock'; end if;
    update cb_ubic set activo = false where cod not in (select upper(trim(e->>'cod')) from jsonb_array_elements(p_lista) e);
  end if;
  insert into cb_ubic(cod, pasillo, rack, nivel, pos, tipo, nota, orden, activo)
  select distinct on (upper(trim(e->>'cod'))) upper(trim(e->>'cod')), left(nullif(trim(e->>'pasillo'),''), 20), left(nullif(trim(e->>'rack'),''), 20),
         left(nullif(trim(e->>'nivel'),''), 20), left(nullif(trim(e->>'pos'),''), 20), left(nullif(trim(e->>'tipo'),''), 30), left(e->>'nota', 200), (o)::int, true
    from jsonb_array_elements(p_lista) with ordinality t(e, o)
  on conflict (cod) do update set pasillo = excluded.pasillo, rack = excluded.rack, nivel = excluded.nivel, pos = excluded.pos,
         tipo = excluded.tipo, nota = excluded.nota, orden = excluded.orden, activo = true;
  get diagnostics n = row_count;
  return jsonb_build_object('n', n, 'activas', (select count(*) from cb_ubic where activo));
end $$;

-- Movimiento registrado desde el panel (corrección o carga inicial), a nombre del supervisor.
create or replace function public.cb_ubic_mover_panel(p_clave text, p_mov jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'ubi_operar');
begin
  return cb_ubic_registrar(p_mov, 'panel', coalesce(cb_sup_nombre(p_clave), 'Supervisor'));
end $$;

-- Anula un movimiento equivocado (queda en el historial). No se puede si deja una ubicación en negativo.
create or replace function public.cb_ubic_anular(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'ubi_operar'); m cb_ubic_mov;
begin
  select * into m from cb_ubic_mov where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if m.anulado is not null then return; end if;
  if m.hacia is not null then perform pg_advisory_xact_lock(hashtext('cb_ubic:' || m.hacia)); end if;
  update cb_ubic_mov set anulado = now(), anulado_por = left(coalesce(cb_sup_nombre(p_clave), 'Supervisor'), 80) where id = p_id;
  if m.hacia is not null and cb_ubic_hay(m.hacia, m.k) < -1e-9 then raise exception 'sin_stock'; end if;   -- ya salió de ahí: no se puede anular
end $$;

-- ---------- Celular de bodega (permiso de usuario "ubic_mover") ----------
create or replace function public.cb_ubic_cel(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'ubic_mover') then raise exception 'sin_permiso'; end if;
  return jsonb_build_object(
    'ubic', coalesce((select jsonb_agg(jsonb_build_array(u.cod, u.pasillo, u.rack, u.nivel) order by u.orden nulls last, u.cod) from cb_ubic u where u.activo), '[]'::jsonb),
    'stock', cb_ubic_stock_json(),
    'mis', coalesce((select jsonb_agg(to_jsonb(m) order by m.t desc) from (select * from cb_ubic_mov where origen = p_puesto
               and t > now() - interval '36 hours' order by t desc limit 300) m), '[]'::jsonb));
end $$;

create or replace function public.cb_ubic_mover(p_puesto text, p_ses text, p_mov jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'ubic_mover') then raise exception 'sin_permiso'; end if;
  return cb_ubic_registrar(p_mov, p_puesto, coalesce(nullif(trim(p_mov->>'persona'), ''), (select nombre from cb_puesto where id = p_puesto)));
end $$;

revoke all on function public.cb_ubic_datos(text, int), public.cb_ubic_guardar(text, jsonb, boolean), public.cb_ubic_mover_panel(text, jsonb),
  public.cb_ubic_anular(text, uuid), public.cb_ubic_cel(text, text), public.cb_ubic_mover(text, text, jsonb) from public;
grant execute on function public.cb_ubic_datos(text, int), public.cb_ubic_guardar(text, jsonb, boolean), public.cb_ubic_mover_panel(text, jsonb),
  public.cb_ubic_anular(text, uuid), public.cb_ubic_cel(text, text), public.cb_ubic_mover(text, text, jsonb) to anon, authenticated;

-- Permisos nuevos: supervisores (ubi_ver, ubi_operar) y usuarios de celular (ubic_mover).
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


create or replace function public.cb_u_guardar(p_clave text, p_id text, p_nombre text, p_area text, p_permisos jsonb, p_activo boolean default true)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := nullif(trim(coalesce(p_id,'')), ''); v_perm text[];
begin
  perform cb_puede(p_clave, 'usr_admin');
  if coalesce(trim(p_nombre),'') = '' then raise exception 'falta_nombre'; end if;
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then raise exception 'datos_invalidos'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_perm from jsonb_array_elements_text(p_permisos) x;
  if exists (select 1 from unnest(v_perm) x where x not in ('conteo','mp_entregar','mp_recibir','pt_entregar','pt_recibir','pt_retirar','dev_cargar','dev_recibir','prov_recibir','ubic_mover')) then raise exception 'datos_invalidos'; end if;
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

