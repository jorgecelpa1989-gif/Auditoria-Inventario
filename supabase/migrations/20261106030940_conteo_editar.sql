
-- =====================================================================
--  Actualización 09 · Modificar conteo (nombre y más códigos) + extender vigencia de entregas MP
--  Solo agrega cosas: la app anterior sigue funcionando igual.
-- =====================================================================

alter table public.cb_conteos add column if not exists editado timestamptz;

-- Supervisor: cambia el nombre de un conteo y/o le agrega productos (no duplica códigos que ya tiene).
create or replace function public.cb_conteo_editar(p_clave text, p_id uuid, p_nombre text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos; v_add jsonb; v_nom text;
begin
  perform cb_check(p_clave);
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

-- Celular del contador: trae la lista actualizada (nombre y productos) de su conteo.
create or replace function public.cb_conteo_items(p_id uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos;
begin
  select * into c from cb_conteos where id = p_id;
  if not found or c.secret_hash is null or c.secret_hash <> extensions.crypt(coalesce(p_secret,''), c.secret_hash) then raise exception 'no_autorizado'; end if;
  return jsonb_build_object('nombre', c.nombre, 'items', c.items, 'editado', c.editado);
end $$;

-- El latido del celular ahora responde cuándo se modificó el conteo (la app anterior ignora la respuesta).
drop function if exists public.cb_latido(uuid, text);
create function public.cb_latido(p_id uuid, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos;
begin
  select * into c from cb_conteos where id = p_id;
  if not found or c.secret_hash is null or c.secret_hash <> extensions.crypt(coalesce(p_secret,''), c.secret_hash) then raise exception 'no_autorizado'; end if;
  update cb_conteos set visto = now() where id = p_id;
  return jsonb_build_object('editado', c.editado);
end $$;

-- Supervisor: extiende la vigencia de una entrega de MP activa (mismo link, mismas lecturas).
create or replace function public.cb_mov_extender(p_clave text, p_id uuid, p_vence timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_vence is null or p_vence <= now() then raise exception 'datos_invalidos'; end if;
  update cb_mov set vence = p_vence
   where id = p_id and finalizado is null and coalesce(meta->>'estado', 'activa') = 'activa';
  if not found then raise exception 'no_existe'; end if;
  return jsonb_build_object('id', p_id, 'vence', p_vence);
end $$;

-- Recepción PT: además de los 3 lados, lista cada usuario con permiso de PT y su señal (para ver quién está realmente en línea).
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
        'retail',     (select jsonb_build_object('visto', max(visto), 'usado', max(usado), 'persona', string_agg(distinct coalesce(persona, nombre), ', ')) from cb_puesto where activo and 'pt_retirar' = any(permisos))),
    'usuarios', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'persona', persona, 'visto', visto, 'usado', usado,
        'lado', case when 'pt_entregar' = any(permisos) then 'produccion' when 'pt_retirar' = any(permisos) then 'retail' else 'bodega' end) order by visto desc nulls last)
      from cb_puesto where activo and permisos && array['pt_entregar','pt_recibir','pt_retirar']::text[]), '[]'::jsonb));
end $$;

revoke all on function public.cb_conteo_editar(text, uuid, text, jsonb), public.cb_conteo_items(uuid, text),
  public.cb_latido(uuid, text), public.cb_mov_extender(text, uuid, timestamptz) from public;
grant execute on function
  public.cb_conteo_editar(text, uuid, text, jsonb), public.cb_conteo_items(uuid, text),
  public.cb_latido(uuid, text), public.cb_mov_extender(text, uuid, timestamptz)
to anon, authenticated;
