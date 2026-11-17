-- =====================================================================
--  ENTREGA MP: CORREGIR UN REGISTRO DESDE EL PANEL (permiso "mp_operar")
--  Cambia la cantidad de una lectura (0 = anular; queda en el historial "ed").
--  cb_mov_enviar: una lectura corregida en el panel se conserva aunque el celular vuelva a enviar su lista.
--  Compatible con la app anterior (mismos parámetros).
-- =====================================================================
create or replace function public.cb_mov_corregir(p_clave text, p_id uuid, p_rol text, p_lid text, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_operar'); m cb_mov; d jsonb; v_por text := left(coalesce(cb_sup_nombre(p_clave), 'Supervisor'), 80);
begin
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  select * into m from cb_mov where id = p_id;
  if not found then raise exception 'no_existe'; end if;
  if m.finalizado is not null then raise exception 'finalizado'; end if;
  select data into d from cb_mov_lect where mov = p_id and rol = p_rol and lid = p_lid for update;
  if not found then raise exception 'no_existe'; end if;
  update cb_mov_lect set data = d || jsonb_build_object('qty', p_qty, 'ed', coalesce(d->'ed', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('de', d->'qty', 'a', p_qty, 'por', v_por, 't', now())))
   where mov = p_id and rol = p_rol and lid = p_lid;
  return jsonb_build_object('lid', p_lid, 'qty', p_qty);
end $$;
grant execute on function public.cb_mov_corregir(text, uuid, text, text, numeric) to anon, authenticated;

create or replace function public.cb_mov_enviar(p_id uuid, p_rol text, p_secret text, p_persona text, p_lecturas jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; n int;
begin
  perform cb_mov_lado_ok(p_id, p_rol, p_secret);
  select * into m from cb_mov where id = p_id;
  if m.finalizado is not null then raise exception 'finalizado'; end if;
  if m.vence is not null and m.vence < now() - interval '24 hours' then raise exception 'vencido'; end if;
  if jsonb_typeof(p_lecturas) <> 'array' or jsonb_array_length(p_lecturas) > 20000 then raise exception 'datos_invalidos'; end if;
  -- lo agregado a mano y lo corregido desde el panel no se borra ni se pisa
  delete from cb_mov_lect where mov = p_id and rol = p_rol and not (data ? 'manual') and not (data ? 'ed');
  insert into cb_mov_lect(mov, rol, lid, data)
    select p_id, p_rol, coalesce(e->>'lid', md5(e::text)), e from jsonb_array_elements(p_lecturas) e
    on conflict (mov, rol, lid) do update set data = case when cb_mov_lect.data ? 'ed' then cb_mov_lect.data else excluded.data end;
  get diagnostics n = row_count;
  update cb_mov_lado set n_lecturas = n, ultimo_envio = now(), visto = now(), persona = left(p_persona, 80) where mov = p_id and rol = p_rol;
  return jsonb_build_object('n', n, 'at', now());
end $$;
