-- =====================================================================
--  Actualización 17b · Entrega MP: agregar registros que faltaron, desde el panel
--  El administrador agrega una lectura a una entrega, del lado que elija (E = bodega entrega,
--  R = producción recibe). Queda marcada como agregada a mano ('manual') y los celulares
--  ya no la borran cuando vuelven a enviar sus lecturas.
--  Solo agrega una función y ajusta cb_mov_enviar: la app anterior sigue funcionando igual.
-- =====================================================================

create or replace function public.cb_mov_agregar_panel(p_clave text, p_id uuid, p_rol text, p_hora text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; v_t timestamptz; v_lid text; v_dia date;
begin
  perform cb_check(p_clave);
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  select * into m from cb_mov where id = p_id;
  if not found then raise exception 'no_existe'; end if;
  if coalesce(p_data->>'code','') = '' or coalesce((p_data->>'qty')::numeric, 0) <= 0 or (p_data->>'qty')::numeric > 1000000 then raise exception 'datos_invalidos'; end if;
  -- la hora se toma en el día en que se creó la entrega (hora de Chile); nunca en el futuro
  v_dia := (m.creado at time zone 'America/Santiago')::date;
  begin v_t := (v_dia + coalesce(nullif(p_hora,'')::time, (m.creado at time zone 'America/Santiago')::time)) at time zone 'America/Santiago';
  exception when others then raise exception 'datos_invalidos'; end;
  if v_t > now() then v_t := now(); end if;
  v_lid := 'man-' || encode(extensions.gen_random_bytes(8), 'hex');
  insert into cb_mov_lect(mov, rol, lid, data)
  values (p_id, p_rol, v_lid, p_data || jsonb_build_object('lid', v_lid, 't', v_t,
          'manual', jsonb_build_object('por', left(coalesce(p_data->>'user', 'Supervisor'), 80), 'at', now(), 'via', 'panel')));
  return jsonb_build_object('lid', v_lid, 't', v_t);
end $$;

revoke all on function public.cb_mov_agregar_panel(text, uuid, text, text, jsonb) from public;
grant execute on function public.cb_mov_agregar_panel(text, uuid, text, text, jsonb) to anon, authenticated;

create or replace function public.cb_mov_enviar(p_id uuid, p_rol text, p_secret text, p_persona text, p_lecturas jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare m cb_mov; n int;
begin
  perform cb_mov_lado_ok(p_id, p_rol, p_secret);
  select * into m from cb_mov where id = p_id;
  if m.finalizado is not null then raise exception 'finalizado'; end if;
  if m.vence is not null and m.vence < now() - interval '24 hours' then raise exception 'vencido'; end if;
  if jsonb_typeof(p_lecturas) <> 'array' or jsonb_array_length(p_lecturas) > 20000 then raise exception 'datos_invalidos'; end if;
  delete from cb_mov_lect where mov = p_id and rol = p_rol and not (data ? 'manual');   -- lo agregado a mano desde el panel no se borra
  insert into cb_mov_lect(mov, rol, lid, data)
    select p_id, p_rol, coalesce(e->>'lid', md5(e::text)), e from jsonb_array_elements(p_lecturas) e
    on conflict (mov, rol, lid) do update set data = excluded.data;
  get diagnostics n = row_count;
  update cb_mov_lado set n_lecturas = n, ultimo_envio = now(), visto = now(), persona = left(p_persona, 80) where mov = p_id and rol = p_rol;
  return jsonb_build_object('n', n, 'at', now());
end $$;
