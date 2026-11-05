-- =====================================================================
--  CONTROL DE OPERACIONES · Grupo Vector
--  Actualización 07: LOGÍSTICA INVERSA (devoluciones a bodega) + celular fijo de DISTRIBUCIÓN
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No borra datos. Se puede ejecutar más de una vez. Requiere la actualización 06.
--  Compatible con la versión anterior de la app: solo agrega una tabla, funciones y el celular 'distribucion'.
--
--  Quién hace qué (por ahora; después se podrá dar a otros usuarios desde 6 · Permisos):
--    · Producción, Picking retail y Distribución CARGAN devoluciones (guía, factura, fecha, SKU, cantidad).
--      Solo se aceptan códigos que existen en la lista de productos (maestro).
--    · Bodega RECEPCIONA: ve lo declarado (guía, factura, productos y cantidades) y acepta o corrige lo que llega.
--    · El supervisor ve el cuadre devuelto vs recibido en 5 · Logística inversa.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Celular fijo nuevo: distribución (devoluciones de clientes).
alter table public.cb_puesto drop constraint if exists cb_puesto_id_check;
alter table public.cb_puesto add constraint cb_puesto_id_check check (id in ('bodega','produccion','retail','distribucion'));

create or replace function public.cb_puesto_link(p_clave text, p_puesto text, p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_puesto not in ('bodega','produccion','retail','distribucion') then raise exception 'datos_invalidos'; end if;
  if length(coalesce(p_token,'')) < 16 then raise exception 'clave_corta'; end if;
  insert into cb_puesto(id, hash) values (p_puesto, extensions.crypt(p_token, extensions.gen_salt('bf')))
  on conflict (id) do update set hash = excluded.hash, creado = now(), usado = null, sesion_hash = null, equipo = null, visto = null;
end $$;

-- ---------- Devoluciones ----------
-- En devoluciones solo se aceptan productos del maestro (lista de productos en cb_catalogo).
create or replace function public.cb_dev_codigos_ok(p_lineas jsonb) returns void
language plpgsql security definer set search_path = public, extensions stable as $$
declare v_mal text;
begin
  if not exists (select 1 from cb_catalogo where id = 1 and jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0) then return; end if;
  select coalesce(e->>'k', e->>'code') into v_mal from jsonb_array_elements(p_lineas) e
   where not exists (select 1 from cb_catalogo c, jsonb_array_elements(c.items) i where c.id = 1 and i->>0 = coalesce(e->>'k', e->>'code'))
   limit 1;
  if v_mal is not null then raise exception 'codigo_no_existe'; end if;
end $$;

create table if not exists public.cb_dev (
  id           uuid primary key default gen_random_uuid(),
  origen       text not null check (origen in ('produccion','retail','distribucion')),
  persona      text,
  guia         text,
  factura      text,
  fecha        date,
  nota         text,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  enviado      timestamptz,                       -- quien devuelve la envió a bodega
  lect         jsonb not null default '[]'::jsonb, -- lo que declara quien devuelve
  rec          jsonb not null default '[]'::jsonb, -- lo que bodega acepta como recibido
  rec_persona  text,
  rec_inicio   timestamptz,
  recibido     timestamptz,                       -- bodega terminó la recepción
  finalizado   timestamptz                        -- el supervisor la cerró
);
create index if not exists cb_dev_creado_idx on public.cb_dev (creado desc);
alter table public.cb_dev enable row level security;
revoke all on public.cb_dev from anon, authenticated;

-- Quien devuelve guarda (borrador) o envía su devolución. Se puede corregir hasta que bodega empiece a recibir.
create or replace function public.cb_dev_guardar(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_lect jsonb, p_enviar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev; v_id uuid := p_id; v_fecha date;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_puesto not in ('produccion','retail','distribucion') then raise exception 'sin_permiso'; end if;
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
    insert into cb_dev(id, origen) values (coalesce(p_id, gen_random_uuid()), p_puesto) returning id into v_id;
  end if;
  update cb_dev set persona = left(coalesce(p_doc->>'persona', persona), 80), guia = left(trim(p_doc->>'guia'), 40),
         factura = left(trim(p_doc->>'factura'), 40), fecha = v_fecha, nota = left(p_doc->>'nota', 300),
         lect = p_lect, actualizado = now(), enviado = case when p_enviar then coalesce(enviado, now()) else enviado end
   where id = v_id;
  return jsonb_build_object('id', v_id, 'enviado', (select enviado from cb_dev where id = v_id));
end $$;

-- Lo que ve cada celular fijo:
--   quien devuelve: sus devoluciones de los últimos 30 días (con su detalle, para seguir o revisar);
--   bodega: las enviadas que falta recibir, más las que recibió hoy, con lo declarado para aceptarlo.
create or replace function public.cb_dev_mis(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_puesto = 'bodega' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'origen', d.origen, 'persona', d.persona, 'guia', d.guia, 'factura', d.factura,
        'fecha', d.fecha, 'nota', d.nota, 'enviado', d.enviado, 'lect', d.lect, 'rec', d.rec, 'rec_persona', d.rec_persona, 'rec_inicio', d.rec_inicio, 'recibido', d.recibido) order by d.enviado)
      from cb_dev d where d.enviado is not null and d.finalizado is null and (d.recibido is null or d.recibido > now() - interval '18 hours')), '[]'::jsonb);
  end if;
  if p_puesto not in ('produccion','retail','distribucion') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'persona', d.persona, 'guia', d.guia, 'factura', d.factura, 'fecha', d.fecha, 'nota', d.nota,
      'creado', d.creado, 'enviado', d.enviado, 'lect', d.lect, 'rec_inicio', d.rec_inicio, 'recibido', d.recibido, 'finalizado', d.finalizado) order by d.creado desc)
    from cb_dev d where d.origen = p_puesto and d.creado > now() - interval '30 days'), '[]'::jsonb);
end $$;

-- Bodega registra lo que recibe (envía todas sus lecturas cada vez) y, al final, termina la recepción.
create or replace function public.cb_dev_recibir(p_puesto text, p_ses text, p_id uuid, p_persona text, p_rec jsonb, p_terminar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_puesto <> 'bodega' then raise exception 'sin_permiso'; end if;
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

-- Supervisor: todas las devoluciones (con lo declarado y lo recibido) para el cuadre.
create or replace function public.cb_dev_listar(p_clave text, p_desde timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((select jsonb_agg(to_jsonb(d) order by d.creado desc) from cb_dev d
    where d.creado > coalesce(p_desde, now() - interval '120 days')), '[]'::jsonb);
end $$;

-- Supervisor: cerrar (queda como histórico) o eliminar una devolución.
create or replace function public.cb_dev_cerrar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  update cb_dev set finalizado = coalesce(finalizado, now()), actualizado = now() where id = p_id;
  if not found then raise exception 'no_existe'; end if;
end $$;

create or replace function public.cb_dev_eliminar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  delete from cb_dev where id = p_id;
end $$;

revoke execute on function public.cb_dev_codigos_ok(jsonb) from public, anon, authenticated;
grant execute on function
  public.cb_puesto_link(text, text, text),
  public.cb_dev_guardar(text, text, uuid, jsonb, jsonb, boolean), public.cb_dev_mis(text, text),
  public.cb_dev_recibir(text, text, uuid, text, jsonb, boolean),
  public.cb_dev_listar(text, timestamptz), public.cb_dev_cerrar(text, uuid), public.cb_dev_eliminar(text, uuid)
to anon, authenticated;
