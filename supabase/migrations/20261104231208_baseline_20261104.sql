-- =====================================================================
--  MIGRACIÓN BASE · 2026-11-04
--  Copia del script completo que ya está aplicado en Supabase
--  (proyecto yqrpsjxpmtaneyzynyyu), extraído de index.html (#sqlScript).
--  Se verificó que las 43 funciones de la base coinciden con este script.
--  En Supabase se registra como migración "baseline_20261104" SIN volver a
--  ejecutar nada (select 1). Este archivo queda como referencia.
--  Cambios futuros: un archivo nuevo por cambio en esta carpeta.
-- =====================================================================

-- =====================================================================
--  CONTEO DE BODEGA · Grupo Vector
--  Script para Supabase (pegar completo en SQL Editor y tocar RUN)
--  Crea las tablas y funciones para que los conteos lleguen solos al Panel.
--  Se puede ejecutar más de una vez sin perder datos.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas (nadie las lee directo: todo pasa por las funciones) ----------
create table if not exists public.cb_admin (
  id      int primary key default 1 check (id = 1),
  hash    text not null,
  creado  timestamptz not null default now()
);

create table if not exists public.cb_conteos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  creado        timestamptz not null default now(),
  vence         timestamptz,
  finalizado    timestamptz,
  token_hash    text not null,          -- llave del link (solo se guarda cifrada)
  device        text,                   -- celular que abrió el link (un solo uso)
  secret_hash   text,                   -- llave de envío de ese celular
  abierto       timestamptz,
  contador      text,
  ultimo_envio  timestamptz,
  n_lecturas    int not null default 0,
  items         jsonb not null,
  meta          jsonb
);

create table if not exists public.cb_lecturas (
  conteo    uuid not null references public.cb_conteos(id) on delete cascade,
  lid       text not null,
  data      jsonb not null,
  recibido  timestamptz not null default now(),
  primary key (conteo, lid)
);

alter table public.cb_admin    enable row level security;
alter table public.cb_conteos  enable row level security;
alter table public.cb_lecturas enable row level security;
revoke all on public.cb_admin, public.cb_conteos, public.cb_lecturas from anon, authenticated;

-- ---------- Supervisor ----------
create or replace function public.cb_es_admin(p_clave text) returns boolean
language sql security definer set search_path = public, extensions stable as $$
  select exists (select 1 from cb_admin where hash = extensions.crypt(coalesce(p_clave,''), hash));
$$;

create or replace function public.cb_check(p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not cb_es_admin(p_clave) then
    perform pg_sleep(0.5);
    raise exception 'clave_supervisor';
  end if;
end $$;

-- Primera vez: guarda la clave del supervisor. Después: solo comprueba que sea la misma.
create or replace function public.cb_configurar(p_clave text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_clave,'')) < 12 then raise exception 'clave_corta'; end if;
  if not exists (select 1 from cb_admin) then
    insert into cb_admin(id, hash) values (1, extensions.crypt(p_clave, extensions.gen_salt('bf')));
    return 'creado';
  end if;
  perform cb_check(p_clave);
  return 'ok';
end $$;

create or replace function public.cb_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid;
begin
  perform cb_check(p_clave);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'sin_productos'; end if;
  insert into cb_conteos(nombre, vence, token_hash, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), p_items, p_meta)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.cb_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'finalizado', c.finalizado,
      'abierto', c.abierto, 'contador', c.contador, 'ultimo_envio', c.ultimo_envio, 'n_lecturas', c.n_lecturas,
      'productos', jsonb_array_length(c.items),
      'contados', (select count(distinct l.data->>'k') from cb_lecturas l where l.conteo = c.id)
    ) order by c.creado desc)
    from cb_conteos c where c.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

create or replace function public.cb_lecturas_de(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_agg(data order by data->>'t') from cb_lecturas where conteo = p_id), '[]'::jsonb);
end $$;

create or replace function public.cb_finalizar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  update cb_conteos set finalizado = coalesce(finalizado, now()) where id = p_id;
end $$;

create or replace function public.cb_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  delete from cb_conteos where id = p_id;
end $$;

-- ---------- Celular del contador ----------
-- Abre el link. El primer celular que lo abre queda dueño del conteo (un solo uso real).
create or replace function public.cb_abrir(p_id uuid, p_token text, p_device text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos; v_secret text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  select * into c from cb_conteos where id = p_id for update;
  if not found or c.token_hash <> extensions.crypt(coalesce(p_token,''), c.token_hash) then
    perform pg_sleep(0.5); raise exception 'no_existe';
  end if;
  if c.finalizado is not null then raise exception 'finalizado'; end if;
  if c.vence is not null and c.vence < now() then raise exception 'vencido'; end if;
  if c.device is not null and c.device <> p_device then raise exception 'usado'; end if;
  update cb_conteos set device = p_device, secret_hash = extensions.crypt(v_secret, extensions.gen_salt('bf')),
         abierto = coalesce(abierto, now()) where id = p_id;
  return jsonb_build_object('nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'items', c.items, 'meta', c.meta, 'secret', v_secret);
end $$;

-- Envía TODAS las lecturas del celular (reemplaza las anteriores: así viajan también correcciones y borrados).
create or replace function public.cb_enviar(p_id uuid, p_secret text, p_contador text, p_lecturas jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos; n int;
begin
  select * into c from cb_conteos where id = p_id for update;
  if not found or c.secret_hash is null or c.secret_hash <> extensions.crypt(coalesce(p_secret,''), c.secret_hash) then
    perform pg_sleep(0.5); raise exception 'no_autorizado';
  end if;
  if c.finalizado is not null then raise exception 'finalizado'; end if;
  if c.vence is not null and c.vence < now() - interval '24 hours' then raise exception 'vencido'; end if;
  if jsonb_typeof(p_lecturas) <> 'array' or jsonb_array_length(p_lecturas) > 20000 then raise exception 'datos_invalidos'; end if;
  delete from cb_lecturas where conteo = p_id;
  insert into cb_lecturas(conteo, lid, data)
    select p_id, coalesce(e->>'lid', md5(e::text)), e from jsonb_array_elements(p_lecturas) e
    on conflict (conteo, lid) do update set data = excluded.data;
  get diagnostics n = row_count;
  update cb_conteos set n_lecturas = n, ultimo_envio = now(), contador = left(p_contador, 80) where id = p_id;
  return jsonb_build_object('n', n, 'at', now());
end $$;

-- Solo las funciones públicas quedan disponibles para la app.
revoke execute on function public.cb_es_admin(text), public.cb_check(text) from public, anon, authenticated;
grant execute on function
  public.cb_configurar(text), public.cb_crear(text, text, timestamptz, jsonb, jsonb), public.cb_listar(text),
  public.cb_lecturas_de(text, uuid), public.cb_finalizar(text, uuid), public.cb_eliminar(text, uuid),
  public.cb_abrir(uuid, text, text), public.cb_enviar(uuid, text, text, jsonb)
to anon, authenticated;

-- =====================================================================
--  AUDITORÍA DE INVENTARIO · Actualización: estado en línea del contador
--  Pegar en Supabase → SQL Editor → Run. No borra datos. Se puede correr más de una vez.
-- =====================================================================
alter table public.cb_conteos add column if not exists visto timestamptz;      -- último "latido" del celular
alter table public.cb_conteos add column if not exists terminado timestamptz;  -- el contador tocó "Terminar conteo"

-- Latido: el celular avisa cada minuto que sigue con la app abierta.
create or replace function public.cb_latido(p_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos;
begin
  select * into c from cb_conteos where id = p_id;
  if not found or c.secret_hash is null or c.secret_hash <> extensions.crypt(coalesce(p_secret,''), c.secret_hash) then raise exception 'no_autorizado'; end if;
  update cb_conteos set visto = now() where id = p_id;
end $$;

-- El contador terminó su conteo en el celular.
create or replace function public.cb_terminar(p_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos;
begin
  select * into c from cb_conteos where id = p_id;
  if not found or c.secret_hash is null or c.secret_hash <> extensions.crypt(coalesce(p_secret,''), c.secret_hash) then raise exception 'no_autorizado'; end if;
  update cb_conteos set terminado = now(), visto = now() where id = p_id;
end $$;

-- El listado del supervisor ahora incluye "visto" y "terminado".
create or replace function public.cb_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'finalizado', c.finalizado,
      'abierto', c.abierto, 'contador', c.contador, 'ultimo_envio', c.ultimo_envio, 'n_lecturas', c.n_lecturas,
      'visto', c.visto, 'terminado', c.terminado,
      'productos', jsonb_array_length(c.items),
      'contados', (select count(distinct l.data->>'k') from cb_lecturas l where l.conteo = c.id)
    ) order by c.creado desc)
    from cb_conteos c where c.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

grant execute on function public.cb_latido(uuid, text), public.cb_terminar(uuid, text) to anon, authenticated;

-- =====================================================================
--  CONTEO DE BODEGA · Grupo Vector
--  Actualización: ENTREGA Y RECEPCIÓN DE MATERIA PRIMA
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No toca los conteos ni sus lecturas. Se puede ejecutar más de una vez.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cb_mov (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  creado      timestamptz not null default now(),
  vence       timestamptz,
  finalizado  timestamptz,
  token_hash  text not null,
  items       jsonb not null,
  meta        jsonb
);

-- Un lado por rol: E = entrega, R = recepción. Cada lado queda en un solo celular.
create table if not exists public.cb_mov_lado (
  mov           uuid not null references public.cb_mov(id) on delete cascade,
  rol           text not null check (rol in ('E','R')),
  device        text not null,
  secret_hash   text not null,
  persona       text,
  abierto       timestamptz not null default now(),
  visto         timestamptz,
  terminado     timestamptz,
  ultimo_envio  timestamptz,
  n_lecturas    int not null default 0,
  primary key (mov, rol)
);

create table if not exists public.cb_mov_lect (
  mov       uuid not null references public.cb_mov(id) on delete cascade,
  rol       text not null,
  lid       text not null,
  data      jsonb not null,
  recibido  timestamptz not null default now(),
  primary key (mov, rol, lid)
);

alter table public.cb_mov      enable row level security;
alter table public.cb_mov_lado enable row level security;
alter table public.cb_mov_lect enable row level security;
revoke all on public.cb_mov, public.cb_mov_lado, public.cb_mov_lect from anon, authenticated;

-- ---------- Supervisor ----------
create or replace function public.cb_mov_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid;
begin
  perform cb_check(p_clave);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'sin_productos'; end if;
  insert into cb_mov(nombre, vence, token_hash, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), p_items, p_meta)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.cb_mov_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'nombre', m.nombre, 'creado', m.creado, 'vence', m.vence, 'finalizado', m.finalizado, 'meta', m.meta,
      'lados', coalesce((select jsonb_object_agg(l.rol, jsonb_build_object(
          'persona', l.persona, 'abierto', l.abierto, 'visto', l.visto, 'terminado', l.terminado,
          'ultimo_envio', l.ultimo_envio, 'n_lecturas', l.n_lecturas)) from cb_mov_lado l where l.mov = m.id), '{}'::jsonb)
    ) order by m.creado desc)
    from cb_mov m where m.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

create or replace function public.cb_mov_lecturas(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_agg(data || jsonb_build_object('rol', rol) order by data->>'t') from cb_mov_lect where mov = p_id), '[]'::jsonb);
end $$;

create or replace function public.cb_mov_finalizar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  update cb_mov set finalizado = coalesce(finalizado, now()) where id = p_id;
end $$;

create or replace function public.cb_mov_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  delete from cb_mov where id = p_id;
end $$;

-- ---------- Celulares (quien entrega y quien recibe) ----------
-- Sin p_rol: solo informa qué roles están tomados (para elegir). Con p_rol: toma ese rol en este celular.
create or replace function public.cb_mov_abrir(p_id uuid, p_token text, p_device text, p_rol text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; l cb_mov_lado; v_secret text := encode(extensions.gen_random_bytes(16), 'hex'); v_mio text;
begin
  select * into m from cb_mov where id = p_id;
  if not found or m.token_hash <> extensions.crypt(coalesce(p_token,''), m.token_hash) then
    perform pg_sleep(0.5); raise exception 'no_existe';
  end if;
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
  if found and l.device <> p_device then raise exception 'rol_tomado'; end if;
  if found then
    update cb_mov_lado set secret_hash = extensions.crypt(v_secret, extensions.gen_salt('bf')), visto = now(), terminado = null where mov = p_id and rol = p_rol;
  else
    insert into cb_mov_lado(mov, rol, device, secret_hash, visto) values (p_id, p_rol, p_device, extensions.crypt(v_secret, extensions.gen_salt('bf')), now());
  end if;
  return jsonb_build_object('nombre', m.nombre, 'creado', m.creado, 'vence', m.vence, 'items', m.items, 'meta', m.meta, 'secret', v_secret, 'rol', p_rol,
    'lect', coalesce((select jsonb_agg(data order by data->>'t') from cb_mov_lect where mov = p_id and rol = p_rol), '[]'::jsonb));
end $$;

create or replace function public.cb_mov_lado_ok(p_id uuid, p_rol text, p_secret text) returns cb_mov_lado
language plpgsql security definer set search_path = public, extensions as $$
declare l cb_mov_lado;
begin
  select * into l from cb_mov_lado where mov = p_id and rol = p_rol;
  if not found or l.secret_hash <> extensions.crypt(coalesce(p_secret,''), l.secret_hash) then
    perform pg_sleep(0.5); raise exception 'no_autorizado';
  end if;
  return l;
end $$;

create or replace function public.cb_mov_enviar(p_id uuid, p_rol text, p_secret text, p_persona text, p_lecturas jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; n int;
begin
  perform cb_mov_lado_ok(p_id, p_rol, p_secret);
  select * into m from cb_mov where id = p_id;
  if m.finalizado is not null then raise exception 'finalizado'; end if;
  if m.vence is not null and m.vence < now() - interval '24 hours' then raise exception 'vencido'; end if;
  if jsonb_typeof(p_lecturas) <> 'array' or jsonb_array_length(p_lecturas) > 20000 then raise exception 'datos_invalidos'; end if;
  delete from cb_mov_lect where mov = p_id and rol = p_rol;
  insert into cb_mov_lect(mov, rol, lid, data)
    select p_id, p_rol, coalesce(e->>'lid', md5(e::text)), e from jsonb_array_elements(p_lecturas) e
    on conflict (mov, rol, lid) do update set data = excluded.data;
  get diagnostics n = row_count;
  update cb_mov_lado set n_lecturas = n, ultimo_envio = now(), visto = now(), persona = left(p_persona, 80) where mov = p_id and rol = p_rol;
  return jsonb_build_object('n', n, 'at', now());
end $$;

create or replace function public.cb_mov_latido(p_id uuid, p_rol text, p_secret text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_mov_lado_ok(p_id, p_rol, p_secret);
  update cb_mov_lado set visto = now() where mov = p_id and rol = p_rol;
end $$;

create or replace function public.cb_mov_terminar(p_id uuid, p_rol text, p_secret text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_mov_lado_ok(p_id, p_rol, p_secret);
  update cb_mov_lado set terminado = now(), visto = now() where mov = p_id and rol = p_rol;
end $$;

revoke execute on function public.cb_mov_lado_ok(uuid, text, text) from public, anon, authenticated;
grant execute on function
  public.cb_mov_crear(text, text, timestamptz, jsonb, jsonb), public.cb_mov_listar(text), public.cb_mov_lecturas(text, uuid),
  public.cb_mov_finalizar(text, uuid), public.cb_mov_eliminar(text, uuid),
  public.cb_mov_abrir(uuid, text, text, text), public.cb_mov_enviar(uuid, text, text, text, jsonb),
  public.cb_mov_latido(uuid, text, text), public.cb_mov_terminar(uuid, text, text)
to anon, authenticated;


-- =====================================================================
--  CONTROL DE OPERACIONES · Grupo Vector
--  Actualización 03: ACCESO DE PRODUCCIÓN + SOLICITUDES + STOCK PARA QUIEN ENTREGA
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No borra datos. Se puede ejecutar más de una vez.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Clave de acceso de producción (solo ve y crea entregas; nunca conteos ni costos).
create table if not exists public.cb_acceso (
  id      text primary key check (id in ('produccion')),
  hash    text not null,
  creado  timestamptz not null default now()
);

-- Catálogo de productos que sube el supervisor al cargar el ERP (sin costos).
-- stock: { "<código>": [disponible, stock total] } — solo lo ve quien entrega el material.
create table if not exists public.cb_catalogo (
  id          int primary key default 1 check (id = 1),
  items       jsonb not null,
  stock       jsonb,
  origen      text,
  actualizado timestamptz not null default now()
);

-- El link de producción se amarra al PRIMER equipo que lo abre (si se reenvía, no abre en otro).
alter table public.cb_acceso add column if not exists usado timestamptz;
alter table public.cb_acceso add column if not exists sesion_hash text;
alter table public.cb_acceso add column if not exists equipo text;
alter table public.cb_acceso add column if not exists visto timestamptz;

-- El link de cada entrega queda guardado para que el supervisor pueda reenviarlo.
alter table public.cb_mov add column if not exists link_token text;

alter table public.cb_acceso   enable row level security;
alter table public.cb_catalogo enable row level security;
revoke all on public.cb_acceso, public.cb_catalogo from anon, authenticated;

-- ¿Quién es? 'admin' (clave de supervisor) o 'prod' (clave de producción). Si no, error.
create or replace function public.cb_rol(p_clave text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if cb_es_admin(p_clave) then return 'admin'; end if;
  if exists (select 1 from cb_acceso where id = 'produccion' and sesion_hash is not null and sesion_hash = extensions.crypt(coalesce(p_clave,''), sesion_hash)) then
    update cb_acceso set visto = now() where id = 'produccion';
    return 'prod';
  end if;
  perform pg_sleep(0.5);
  raise exception 'acceso_produccion';
end $$;

-- Equipo del jefe de producción: el primer equipo que abre el link queda vinculado y recibe su llave de sesión.
create or replace function public.cb_prod_vincular(p_token text, p_equipo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a cb_acceso; v_ses text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into a from cb_acceso where id = 'produccion' for update;
  if not found or a.hash <> extensions.crypt(coalesce(p_token,''), a.hash) then perform pg_sleep(0.5); raise exception 'acceso_produccion'; end if;
  if a.usado is not null then raise exception 'prod_usado'; end if;
  update cb_acceso set usado = now(), visto = now(), equipo = left(p_equipo, 120), sesion_hash = extensions.crypt(v_ses, extensions.gen_salt('bf')) where id = 'produccion';
  return v_ses;
end $$;

-- Supervisor: ver si el link de producción ya está vinculado y a qué equipo.
create or replace function public.cb_prod_estado(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return (select jsonb_build_object('creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto) from cb_acceso where id = 'produccion');
end $$;

-- Supervisor: crea o cambia la clave de producción (la anterior deja de funcionar).
create or replace function public.cb_prod_clave(p_clave text, p_nueva text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if length(coalesce(p_nueva,'')) < 16 then raise exception 'clave_corta'; end if;
  insert into cb_acceso(id, hash) values ('produccion', extensions.crypt(p_nueva, extensions.gen_salt('bf')))
  on conflict (id) do update set hash = excluded.hash, creado = now(), usado = null, sesion_hash = null, equipo = null, visto = null;
end $$;

-- Supervisor: sube el catálogo y el stock del ERP.
create or replace function public.cb_catalogo_subir(p_clave text, p_items jsonb, p_stock jsonb, p_origen text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'sin_productos'; end if;
  insert into cb_catalogo(id, items, stock, origen, actualizado) values (1, p_items, p_stock, left(p_origen, 200), now())
  on conflict (id) do update set items = excluded.items, stock = excluded.stock, origen = excluded.origen, actualizado = now();
end $$;

-- Supervisor o producción: catálogo para buscar códigos (sin stock).
create or replace function public.cb_catalogo_ver(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_rol(p_clave);
begin
  return (select jsonb_build_object('items', items, 'actualizado', actualizado, 'origen', origen) from cb_catalogo where id = 1);
end $$;

-- ---------- Entregas: ahora también para producción ----------
create or replace function public.cb_mov_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid; v_items jsonb := p_items; r text := cb_rol(p_clave);
begin
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    select items into v_items from cb_catalogo where id = 1;
  end if;
  if v_items is null or jsonb_array_length(v_items) = 0 then raise exception 'sin_productos'; end if;
  if r = 'prod' then
    -- Producción solo envía la SOLICITUD: no hay link hasta que bodega (supervisor) lo genere.
    if jsonb_typeof(p_meta -> 'sol') <> 'array' or jsonb_array_length(p_meta -> 'sol') = 0 then raise exception 'sin_productos'; end if;
    insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
    values (left(p_nombre, 120), null, extensions.crypt(encode(extensions.gen_random_bytes(16), 'hex'), extensions.gen_salt('bf')), null, v_items,
            coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('creado_por', r, 'estado', 'solicitada'))
    returning id into v_id;
    return jsonb_build_object('id', v_id);
  end if;
  insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), v_token, v_items,
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('creado_por', r, 'estado', 'activa'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- Supervisor: convierte una solicitud de producción en entrega con link para los operarios.
create or replace function public.cb_mov_activar(p_clave text, p_id uuid, p_vence timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  perform cb_check(p_clave);
  update cb_mov set token_hash = extensions.crypt(v_token, extensions.gen_salt('bf')), link_token = v_token, vence = p_vence,
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('estado', 'activa', 'activada', now())
   where id = p_id and finalizado is null;
  if not found then raise exception 'no_existe'; end if;
  return jsonb_build_object('id', p_id, 'token', v_token);
end $$;

create or replace function public.cb_mov_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_rol(p_clave);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'nombre', m.nombre, 'creado', m.creado, 'vence', m.vence, 'finalizado', m.finalizado, 'meta', m.meta, 'token', case when r = 'admin' then m.link_token end,
      'lados', coalesce((select jsonb_object_agg(l.rol, jsonb_build_object(
          'persona', l.persona, 'abierto', l.abierto, 'visto', l.visto, 'terminado', l.terminado,
          'ultimo_envio', l.ultimo_envio, 'n_lecturas', l.n_lecturas)) from cb_mov_lado l where l.mov = m.id), '{}'::jsonb)
    ) order by m.creado desc)
    from cb_mov m where m.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

create or replace function public.cb_mov_lecturas(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_rol(p_clave);
begin
  return coalesce((select jsonb_agg(data || jsonb_build_object('rol', rol) order by data->>'t') from cb_mov_lect where mov = p_id), '[]'::jsonb);
end $$;

create or replace function public.cb_mov_finalizar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_rol(p_clave);
begin
  update cb_mov set finalizado = coalesce(finalizado, now()) where id = p_id;
end $$;

-- Celular: igual que antes, y quien ENTREGA recibe además el stock de lo solicitado.
create or replace function public.cb_mov_abrir(p_id uuid, p_token text, p_device text, p_rol text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; l cb_mov_lado; v_secret text := encode(extensions.gen_random_bytes(16), 'hex'); v_mio text; v_stock jsonb; v_at timestamptz;
begin
  select * into m from cb_mov where id = p_id;
  if not found or m.token_hash <> extensions.crypt(coalesce(p_token,''), m.token_hash) then
    perform pg_sleep(0.5); raise exception 'no_existe';
  end if;
  if coalesce(m.meta ->> 'estado', 'activa') = 'solicitada' then perform pg_sleep(0.5); raise exception 'no_existe'; end if;
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
end $$;

revoke execute on function public.cb_rol(text) from public, anon, authenticated;
grant execute on function
  public.cb_prod_clave(text, text), public.cb_prod_vincular(text, text), public.cb_prod_estado(text), public.cb_mov_activar(text, uuid, timestamptz), public.cb_catalogo_subir(text, jsonb, jsonb, text), public.cb_catalogo_ver(text),
  public.cb_mov_crear(text, text, timestamptz, jsonb, jsonb), public.cb_mov_listar(text), public.cb_mov_lecturas(text, uuid),
  public.cb_mov_finalizar(text, uuid), public.cb_mov_abrir(uuid, text, text, text)
to anon, authenticated;


-- =====================================================================
--  CONTROL DE OPERACIONES · Grupo Vector
--  Actualización 04: CELULARES FIJOS (bodega y producción) + PRODUCTO TERMINADO (PT)
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No borra datos. Se puede ejecutar más de una vez.
--  Requiere haber ejecutado antes la actualización 03 (acceso de producción).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Celulares fijos: uno de bodega y uno de producción ----------
-- El link de cada celular queda amarrado al primer equipo que lo abre (si se reenvía, no abre en otro).
create table if not exists public.cb_puesto (
  id          text primary key check (id in ('bodega','produccion')),
  hash        text not null,
  creado      timestamptz not null default now(),
  usado       timestamptz,
  sesion_hash text,
  equipo      text,
  visto       timestamptz,
  persona     text
);

-- Conteos: guardan su link para poder asignarlos al celular de bodega.
alter table public.cb_conteos add column if not exists link_token text;
alter table public.cb_conteos add column if not exists puesto text;

-- ---------- Producto terminado: cada pallet que sale de máquina y cada pallet que recibe bodega ----------
create table if not exists public.cb_pt (
  lid     text primary key,
  puesto  text not null check (puesto in ('bodega','produccion')),
  pallet  text not null,
  data    jsonb not null,
  t       timestamptz not null default now()
);
create index if not exists cb_pt_t on public.cb_pt (t);
create index if not exists cb_pt_pallet on public.cb_pt (pallet);

-- Cada "Terminar proceso" (cierre de turno) de PT queda registrado.
create table if not exists public.cb_pt_cierre (
  id      bigserial primary key,
  puesto  text not null,
  persona text,
  t       timestamptz not null default now()
);

alter table public.cb_puesto    enable row level security;
alter table public.cb_pt        enable row level security;
alter table public.cb_pt_cierre enable row level security;
revoke all on public.cb_puesto, public.cb_pt, public.cb_pt_cierre from anon, authenticated;

-- ---------- Supervisor: links de los celulares fijos ----------
create or replace function public.cb_puesto_link(p_clave text, p_puesto text, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_puesto not in ('bodega','produccion') then raise exception 'datos_invalidos'; end if;
  if length(coalesce(p_token,'')) < 16 then raise exception 'clave_corta'; end if;
  insert into cb_puesto(id, hash) values (p_puesto, extensions.crypt(p_token, extensions.gen_salt('bf')))
  on conflict (id) do update set hash = excluded.hash, creado = now(), usado = null, sesion_hash = null, equipo = null, visto = null;
end $$;

create or replace function public.cb_puesto_estado(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_object_agg(id, jsonb_build_object('creado', creado, 'usado', usado, 'equipo', equipo, 'visto', visto, 'persona', persona)) from cb_puesto), '{}'::jsonb);
end $$;

-- ---------- Celular fijo: se vincula una vez y luego se identifica con su llave ----------
create or replace function public.cb_puesto_vincular(p_puesto text, p_token text, p_equipo text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare a cb_puesto; v_ses text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  select * into a from cb_puesto where id = p_puesto for update;
  if not found or a.hash <> extensions.crypt(coalesce(p_token,''), a.hash) then perform pg_sleep(0.5); raise exception 'puesto_invalido'; end if;
  if a.usado is not null then raise exception 'puesto_usado'; end if;
  update cb_puesto set usado = now(), visto = now(), equipo = left(p_equipo, 120), sesion_hash = extensions.crypt(v_ses, extensions.gen_salt('bf')) where id = p_puesto;
  return v_ses;
end $$;

create or replace function public.cb_puesto_ok(p_puesto text, p_ses text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from cb_puesto where id = p_puesto and sesion_hash is not null and sesion_hash = extensions.crypt(coalesce(p_ses,''), sesion_hash)) then
    perform pg_sleep(0.5); raise exception 'puesto_invalido';
  end if;
  update cb_puesto set visto = now() where id = p_puesto;
end $$;

-- Tareas del celular: entregas de MP asignadas y (solo bodega) conteos asignados.
create or replace function public.cb_puesto_tareas(p_puesto text, p_ses text, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_rol text := case when p_puesto = 'bodega' then 'E' else 'R' end;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_persona is not null and p_persona <> '' then update cb_puesto set persona = left(p_persona, 80) where id = p_puesto; end if;
  return jsonb_build_object(
    'mp', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'ref', m.meta->>'ref', 'por', m.meta->>'por', 'token', m.link_token,
              'creado', m.creado, 'vence', m.vence, 'productos', jsonb_array_length(coalesce(m.meta->'sol','[]'::jsonb)),
              'terminado', (select l.terminado from cb_mov_lado l where l.mov = m.id and l.rol = v_rol)) order by m.creado)
            from cb_mov m where coalesce(m.meta->>'estado','activa') = 'activa' and m.meta->>'puestos' = 'true' and m.finalizado is null
              and m.link_token is not null and (m.vence is null or m.vence > now())), '[]'::jsonb),
    'conteos', case when p_puesto = 'bodega' then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'token', c.link_token,
              'creado', c.creado, 'vence', c.vence, 'productos', jsonb_array_length(c.items), 'terminado', c.terminado) order by c.creado)
            from cb_conteos c where c.puesto = 'bodega' and c.finalizado is null and c.link_token is not null and (c.vence is null or c.vence > now())), '[]'::jsonb)
            else '[]'::jsonb end,
    'pt_cierre', (select max(t) from cb_pt_cierre where puesto = p_puesto));
end $$;

-- ---------- Asignar tareas a los celulares fijos (supervisor) ----------
create or replace function public.cb_mov_asignar(p_clave text, p_id uuid, p_si boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  update cb_mov set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('puestos', p_si) where id = p_id;
end $$;

create or replace function public.cb_conteo_asignar(p_clave text, p_id uuid, p_puesto text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  update cb_conteos set puesto = nullif(p_puesto, '') where id = p_id;
end $$;

-- Conteos: ahora guardan su link (para poder asignarlos) y el listado dice a qué celular están asignados.
create or replace function public.cb_crear(p_clave text, p_nombre text, p_vence timestamptz, p_items jsonb, p_meta jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid;
begin
  perform cb_check(p_clave);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'sin_productos'; end if;
  insert into cb_conteos(nombre, vence, token_hash, link_token, items, meta)
  values (left(p_nombre, 120), p_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), v_token, p_items, p_meta)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.cb_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'finalizado', c.finalizado,
      'abierto', c.abierto, 'contador', c.contador, 'ultimo_envio', c.ultimo_envio, 'n_lecturas', c.n_lecturas,
      'visto', c.visto, 'terminado', c.terminado, 'puesto', c.puesto, 'asignable', c.link_token is not null,
      'productos', jsonb_array_length(c.items),
      'contados', (select count(distinct l.data->>'k') from cb_lecturas l where l.conteo = c.id)
    ) order by c.creado desc)
    from cb_conteos c where c.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

-- ---------- PT desde los celulares fijos ----------
-- Producción registra cada pallet que sale de máquina; bodega cada pallet que recibe.
create or replace function public.cb_pt_registrar(p_puesto text, p_ses text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if coalesce(p_data->>'lid','') = '' or coalesce(p_data->>'pallet','') = '' then raise exception 'datos_invalidos'; end if;
  insert into cb_pt(lid, puesto, pallet, data) values (p_data->>'lid', p_puesto, upper(left(p_data->>'pallet', 60)), p_data)
  on conflict (lid) do update set pallet = excluded.pallet, data = excluded.data where cb_pt.puesto = p_puesto;
end $$;

create or replace function public.cb_pt_borrar(p_puesto text, p_ses text, p_lid text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  delete from cb_pt where lid = p_lid and puesto = p_puesto;
end $$;

-- Pallets de este celular desde su último cierre (para la lista en pantalla).
create or replace function public.cb_pt_mis(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_desde timestamptz;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  select max(t) into v_desde from cb_pt_cierre where puesto = p_puesto;
  return coalesce((select jsonb_agg(data order by t) from cb_pt where puesto = p_puesto and t > coalesce(v_desde, now() - interval '2 days')), '[]'::jsonb);
end $$;

-- Bodega: al escanear un pallet, trae lo que declaró producción (producto y cantidad) para confirmar rápido.
create or replace function public.cb_pt_buscar(p_puesto text, p_ses text, p_pallet text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  return (select data from cb_pt where puesto = 'produccion' and pallet = upper(p_pallet) and t > now() - interval '30 days' order by t desc limit 1);
end $$;

-- "Terminar proceso": cierra el turno de este celular (el link sigue abierto).
create or replace function public.cb_pt_cerrar(p_puesto text, p_ses text, p_persona text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  insert into cb_pt_cierre(puesto, persona) values (p_puesto, left(p_persona, 80));
end $$;

-- Panel (supervisor o jefe de producción): pallets de ambos lados y cierres desde una fecha.
create or replace function public.cb_pt_listar(p_clave text, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_rol(p_clave);
begin
  return jsonb_build_object(
    'pallets', coalesce((select jsonb_agg(data || jsonb_build_object('puesto', puesto, 'pallet', pallet, 'rt', t) order by t) from cb_pt where t >= p_desde), '[]'::jsonb),
    'cierres', coalesce((select jsonb_agg(jsonb_build_object('puesto', puesto, 'persona', persona, 't', t) order by t) from cb_pt_cierre where t >= p_desde - interval '1 day'), '[]'::jsonb),
    'puestos', coalesce((select jsonb_object_agg(id, jsonb_build_object('visto', visto, 'persona', persona, 'usado', usado)) from cb_puesto), '{}'::jsonb));
end $$;

-- Lista de productos para el celular fijo (sin stock ni costos).
create or replace function public.cb_puesto_catalogo(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  return (select jsonb_build_object('items', items, 'actualizado', actualizado) from cb_catalogo where id = 1);
end $$;

revoke execute on function public.cb_puesto_ok(text, text) from public, anon, authenticated;
grant execute on function
  public.cb_puesto_link(text, text, text), public.cb_puesto_estado(text), public.cb_puesto_vincular(text, text, text),
  public.cb_puesto_tareas(text, text, text), public.cb_mov_asignar(text, uuid, boolean), public.cb_conteo_asignar(text, uuid, text),
  public.cb_crear(text, text, timestamptz, jsonb, jsonb), public.cb_listar(text),
  public.cb_pt_registrar(text, text, jsonb), public.cb_pt_borrar(text, text, text), public.cb_pt_mis(text, text),
  public.cb_pt_buscar(text, text, text), public.cb_pt_cerrar(text, text, text), public.cb_pt_listar(text, timestamptz), public.cb_puesto_catalogo(text, text)
to anon, authenticated;


-- =====================================================================
--  CONTROL DE OPERACIONES · Grupo Vector
--  Actualización 05: TERCER CELULAR FIJO — PICKING RETAIL (solo recepción de PT)
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No borra datos. Se puede ejecutar más de una vez. Requiere la actualización 04.
-- =====================================================================

-- Permitir el celular 'retail' en los celulares fijos y en los registros de PT.
alter table public.cb_puesto drop constraint if exists cb_puesto_id_check;
alter table public.cb_puesto add constraint cb_puesto_id_check check (id in ('bodega','produccion','retail'));
alter table public.cb_pt drop constraint if exists cb_pt_puesto_check;
alter table public.cb_pt add constraint cb_pt_puesto_check check (puesto in ('bodega','produccion','retail'));

create or replace function public.cb_puesto_link(p_clave text, p_puesto text, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_puesto not in ('bodega','produccion','retail') then raise exception 'datos_invalidos'; end if;
  if length(coalesce(p_token,'')) < 16 then raise exception 'clave_corta'; end if;
  insert into cb_puesto(id, hash) values (p_puesto, extensions.crypt(p_token, extensions.gen_salt('bf')))
  on conflict (id) do update set hash = excluded.hash, creado = now(), usado = null, sesion_hash = null, equipo = null, visto = null;
end $$;

-- Tareas: bodega entrega MP y cuenta; producción recibe MP; retail no tiene tareas asignadas (solo PT).
create or replace function public.cb_puesto_tareas(p_puesto text, p_ses text, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_rol text := case when p_puesto = 'bodega' then 'E' when p_puesto = 'produccion' then 'R' else null end;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_persona is not null and p_persona <> '' then update cb_puesto set persona = left(p_persona, 80) where id = p_puesto; end if;
  return jsonb_build_object(
    'mp', case when v_rol is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nombre', m.nombre, 'ref', m.meta->>'ref', 'por', m.meta->>'por', 'token', m.link_token,
              'creado', m.creado, 'vence', m.vence, 'productos', jsonb_array_length(coalesce(m.meta->'sol','[]'::jsonb)),
              'terminado', (select l.terminado from cb_mov_lado l where l.mov = m.id and l.rol = v_rol)) order by m.creado)
            from cb_mov m where coalesce(m.meta->>'estado','activa') = 'activa' and m.meta->>'puestos' = 'true' and m.finalizado is null
              and m.link_token is not null and (m.vence is null or m.vence > now())), '[]'::jsonb) end,
    'conteos', case when p_puesto = 'bodega' then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'token', c.link_token,
              'creado', c.creado, 'vence', c.vence, 'productos', jsonb_array_length(c.items), 'terminado', c.terminado) order by c.creado)
            from cb_conteos c where c.puesto = 'bodega' and c.finalizado is null and c.link_token is not null and (c.vence is null or c.vence > now())), '[]'::jsonb)
            else '[]'::jsonb end,
    'pt_cierre', (select max(t) from cb_pt_cierre where puesto = p_puesto));
end $$;

grant execute on function public.cb_puesto_link(text, text, text), public.cb_puesto_tareas(text, text, text) to anon, authenticated;
