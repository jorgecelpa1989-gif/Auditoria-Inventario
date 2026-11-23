-- =====================================================================
--  Inventario → Almacenamiento: pasar un conteo (con sus ubicaciones) al stock por ubicación.
--  · Ajusta cada ubicación/SKU elegido a lo contado: ingreso o salida "ajuste por inventario" (queda en el historial, se puede anular).
--  · Crea las ubicaciones que no existían (las que el supervisor marcó).
--  · Guarda el IRA (precisión del stock por ubicación) de cada pase.
--  Permiso: ubi_operar (el panel además necesita inv_ver para leer las lecturas del conteo). Solo agrega: lo demás sigue igual.
-- =====================================================================
create table if not exists public.cb_ubic_inv (
  id       uuid primary key default gen_random_uuid(),
  t        timestamptz not null default now(),
  conteo   uuid,
  nombre   text,
  persona  text,
  n        int not null default 0,      -- líneas comparadas (ubicación + SKU)
  ok       int not null default 0,      -- líneas que cuadraban antes del ajuste
  ira      numeric,                     -- ok / n (0 a 1)
  ingresos int not null default 0,
  salidas  int not null default 0,
  nuevas   int not null default 0,      -- ubicaciones creadas
  detalle  jsonb
);
create index if not exists cb_ubic_inv_t_idx on public.cb_ubic_inv (t desc);
alter table public.cb_ubic_inv enable row level security;
revoke all on public.cb_ubic_inv from public, anon, authenticated;

create or replace function public.cb_ubic_inv_aplicar(p_clave text, p_conteo uuid, p_nuevas jsonb, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'ubi_operar'); v_nom text; v_per text := coalesce(cb_sup_nombre(p_clave), 'Supervisor');
        e jsonb; v_u text; v_k text; v_obj numeric; v_f numeric; v_hay numeric; v_dif numeric; v_apl boolean; v_ira boolean;
        n int := 0; v_ok int := 0; v_in int := 0; v_out int := 0; v_nu int := 0; v_det jsonb := '[]'::jsonb; v_nota text;
begin
  select nombre into v_nom from cb_conteos where id = p_conteo;
  if not found then raise exception 'no_existe'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 5000 then raise exception 'datos_invalidos'; end if;
  if p_nuevas is not null and (jsonb_typeof(p_nuevas) <> 'array' or jsonb_array_length(p_nuevas) > 2000) then raise exception 'datos_invalidos'; end if;
  v_nota := left('Ajuste por inventario: ' || coalesce(v_nom, ''), 200);
  -- ubicaciones nuevas (si ya existía inactiva, se reactiva sin tocar sus datos)
  for e in select * from jsonb_array_elements(coalesce(p_nuevas, '[]'::jsonb)) loop
    v_u := upper(trim(coalesce(e->>'cod', '')));
    if v_u = '' or length(v_u) > 40 then raise exception 'datos_invalidos'; end if;
    insert into cb_ubic(cod, pasillo, rack, nivel, pos, tipo, nota, orden, activo)
    values (v_u, left(nullif(trim(e->>'pasillo'), ''), 20), left(nullif(trim(e->>'rack'), ''), 40), left(nullif(trim(e->>'nivel'), ''), 20), null,
            left(nullif(trim(e->>'tipo'), ''), 30), 'Creada desde el inventario ' || coalesce(v_nom, ''), 100000, true)
    on conflict (cod) do update set activo = true where cb_ubic.activo = false;
    if found then v_nu := v_nu + 1; end if;
  end loop;
  -- ajuste de cada ubicación + SKU a lo contado (el stock actual lo calcula el servidor)
  for e in select * from jsonb_array_elements(p_lineas) loop
    v_u := upper(trim(coalesce(e->>'u', ''))); v_k := nullif(trim(coalesce(e->>'k', '')), '');
    begin v_obj := (e->>'obj')::numeric; v_f := coalesce(nullif(e->>'f', '')::numeric, 1);
          v_apl := coalesce((e->>'aplicar')::boolean, true); v_ira := coalesce((e->>'ira')::boolean, true);
    exception when others then raise exception 'datos_invalidos'; end;
    if v_u = '' or v_k is null or length(v_k) > 40 or v_obj is null or v_obj < 0 or v_obj > 100000000 or v_f <= 0 or v_f > 100000 then raise exception 'datos_invalidos'; end if;
    if not exists (select 1 from cb_ubic where cod = v_u and activo) then raise exception 'ubicacion_no_existe'; end if;
    perform pg_advisory_xact_lock(hashtext('cb_ubic:' || v_u));
    v_hay := cb_ubic_hay(v_u, v_k); v_dif := v_obj - v_hay;
    if v_ira then n := n + 1; if abs(v_dif) < 1e-9 then v_ok := v_ok + 1; end if; end if;   -- IRA: solo ubicaciones que ya existían
    if abs(v_dif) < 1e-9 or not v_apl then null;   -- cuadra, o el supervisor no la marcó: no se mueve
    elsif v_dif > 0 then
      perform cb_ubic_registrar(jsonb_build_object('tipo', 'ingreso', 'hacia', v_u, 'k', v_k, 'qty', v_dif / v_f, 'f', v_f, 'ce', e->>'ce', 'um', e->>'um', 'desc', e->>'desc', 'nota', v_nota), 'inventario', v_per);
      v_in := v_in + 1;
    else
      perform cb_ubic_registrar(jsonb_build_object('tipo', 'salida', 'desde', v_u, 'k', v_k, 'qty', -v_dif / v_f, 'f', v_f, 'ce', e->>'ce', 'um', e->>'um', 'desc', e->>'desc', 'nota', v_nota), 'inventario', v_per);
      v_out := v_out + 1;
    end if;
    v_det := v_det || jsonb_build_array(jsonb_build_object('u', v_u, 'k', v_k, 'antes', v_hay, 'contado', v_obj, 'aplicado', v_apl and abs(v_dif) >= 1e-9));
  end loop;
  insert into cb_ubic_inv(conteo, nombre, persona, n, ok, ira, ingresos, salidas, nuevas, detalle)
  values (p_conteo, v_nom, v_per, n, v_ok, case when n > 0 then round(v_ok::numeric / n, 4) end, v_in, v_out, v_nu, v_det);
  return jsonb_build_object('n', n, 'ok', v_ok, 'ira', case when n > 0 then round(v_ok::numeric / n, 4) end, 'ingresos', v_in, 'salidas', v_out, 'nuevas', v_nu);
end $$;

-- Historial de pases (IRA de cada uno), para el panel.
create or replace function public.cb_ubic_inv_hist(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'ubi_ver');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('t', t, 'nombre', nombre, 'persona', persona, 'n', n, 'ok', ok, 'ira', ira,
                    'ingresos', ingresos, 'salidas', salidas, 'nuevas', nuevas) order by t desc)
                   from (select * from cb_ubic_inv order by t desc limit 30) x), '[]'::jsonb);
end $$;

revoke all on function public.cb_ubic_inv_aplicar(text, uuid, jsonb, jsonb), public.cb_ubic_inv_hist(text) from public;
grant execute on function public.cb_ubic_inv_aplicar(text, uuid, jsonb, jsonb), public.cb_ubic_inv_hist(text) to anon, authenticated;
