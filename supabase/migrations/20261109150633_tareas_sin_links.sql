
-- =====================================================================
--  Actualización 15 · Las tareas llegan directo a la app del usuario asignado (sin links)
--  El usuario abre su entrega de MP o su conteo desde su app; el servidor lo valida por su
--  sesión y sus permisos. Si ese lado/conteo quedó tomado por otro equipo (un link abierto
--  antes en otro navegador, un celular anterior), la app del usuario lo toma y conserva las
--  lecturas. Solo agrega funciones: la app anterior sigue funcionando igual.
-- =====================================================================

-- Entrega de MP: toma el lado del usuario (E si tiene "Entrega MP", R si tiene "Recibe MP").
create or replace function public.cb_puesto_mov_tomar(p_puesto text, p_ses text, p_id uuid, p_device text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; v_rol text;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  v_rol := case when cb_u_tiene(p_puesto, 'mp_entregar') then 'E' when cb_u_tiene(p_puesto, 'mp_recibir') then 'R' end;
  if v_rol is null then raise exception 'sin_permiso'; end if;
  if coalesce(p_device, '') = '' or p_device = '__bloqueado__' then raise exception 'datos_invalidos'; end if;
  select * into m from cb_mov where id = p_id;
  if not found or m.link_token is null then raise exception 'no_existe'; end if;
  if coalesce(m.meta ->> 'estado', 'activa') <> 'activa' then raise exception 'no_existe'; end if;
  if coalesce(m.meta ->> 'puestos', '') <> 'true' then raise exception 'sin_permiso'; end if;
  -- El lado lo tenía otro equipo (no bloqueado): pasa al equipo de este usuario. Las lecturas se mantienen.
  delete from cb_mov_lado where mov = p_id and rol = v_rol and device <> p_device and device <> '__bloqueado__';
  -- Si este equipo había tomado el otro rol por error en esta entrega, se suelta (cada usuario tiene un solo rol).
  delete from cb_mov_lado where mov = p_id and rol <> v_rol and device = p_device;
  return cb_mov_abrir(p_id, m.link_token, p_device, v_rol);
end $$;

-- Conteo de inventario: solo el usuario al que está asignado; si estaba abierto en otro equipo, pasa a este.
create or replace function public.cb_puesto_conteo_tomar(p_puesto text, p_ses text, p_id uuid, p_device text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c cb_conteos;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'conteo') then raise exception 'sin_permiso'; end if;
  if coalesce(p_device, '') = '' or p_device = '__bloqueado__' then raise exception 'datos_invalidos'; end if;
  select * into c from cb_conteos where id = p_id for update;
  if not found or c.link_token is null then raise exception 'no_existe'; end if;
  if c.puesto is distinct from p_puesto then raise exception 'sin_permiso'; end if;
  if c.device is not null and c.device <> p_device and c.device <> '__bloqueado__' then
    update cb_conteos set device = null, secret_hash = null, terminado = null where id = p_id;
  end if;
  return cb_abrir(p_id, c.link_token, p_device);
end $$;

revoke all on function public.cb_puesto_mov_tomar(text, text, uuid, text), public.cb_puesto_conteo_tomar(text, text, uuid, text) from public;
grant execute on function public.cb_puesto_mov_tomar(text, text, uuid, text), public.cb_puesto_conteo_tomar(text, text, uuid, text) to anon, authenticated;
