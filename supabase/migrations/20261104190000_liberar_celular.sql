-- =====================================================================
--  CONTROL DE OPERACIONES · Grupo Vector
--  Actualización 06: LIBERAR CELULAR + RECUPERAR LECTURAS
--  Pegar completo en SQL Editor de Supabase y tocar RUN (una sola vez).
--  No borra datos. Se puede ejecutar más de una vez. Requiere la actualización 05.
--  Compatible con la versión anterior de la app: solo agrega funciones y datos en las respuestas.
-- =====================================================================

-- El supervisor libera un conteo que quedó amarrado a un celular (cambio de teléfono, iPhone con
-- ícono en la pantalla de inicio, datos borrados…). El celular anterior ya no puede enviar más y el
-- próximo que abra el link queda como dueño. Las lecturas ya recibidas se mantienen.
create or replace function public.cb_liberar(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_fin timestamptz;
begin
  perform cb_check(p_clave);
  select finalizado into v_fin from cb_conteos where id = p_id for update;
  if not found then raise exception 'no_existe'; end if;
  if v_fin is not null then raise exception 'finalizado'; end if;
  update cb_conteos set device = null, secret_hash = null, terminado = null where id = p_id;
end $$;

-- Lo mismo para un lado (E = entrega, R = recepción) de una entrega de materia prima.
-- Las lecturas de ese lado (cb_mov_lect) se mantienen y cb_mov_abrir ya las devuelve al celular nuevo.
create or replace function public.cb_mov_liberar(p_clave text, p_id uuid, p_rol text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  if exists (select 1 from cb_mov where id = p_id and finalizado is not null) then raise exception 'finalizado'; end if;
  delete from cb_mov_lado where mov = p_id and rol = p_rol;
end $$;

-- Abrir el link ahora devuelve también las lecturas que ya llegaron ('lect'), para que un celular
-- liberado siga desde ahí y su primer envío no borre lo que ya estaba guardado.
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
  return jsonb_build_object('nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'items', c.items, 'meta', c.meta, 'secret', v_secret,
    'lect', coalesce((select jsonb_agg(data order by data->>'t') from cb_lecturas where conteo = p_id), '[]'::jsonb));
end $$;

-- El listado del supervisor indica si el conteo está libre (sin celular dueño) para mostrar de nuevo el link.
create or replace function public.cb_listar(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'creado', c.creado, 'vence', c.vence, 'finalizado', c.finalizado,
      'abierto', c.abierto, 'contador', c.contador, 'ultimo_envio', c.ultimo_envio, 'n_lecturas', c.n_lecturas,
      'visto', c.visto, 'terminado', c.terminado, 'puesto', c.puesto, 'asignable', c.link_token is not null,
      'libre', c.device is null,
      'productos', jsonb_array_length(c.items),
      'contados', (select count(distinct l.data->>'k') from cb_lecturas l where l.conteo = c.id)
    ) order by c.creado desc)
    from cb_conteos c where c.creado > now() - interval '120 days'), '[]'::jsonb);
end $$;

grant execute on function public.cb_liberar(text, uuid), public.cb_mov_liberar(text, uuid, text) to anon, authenticated;
