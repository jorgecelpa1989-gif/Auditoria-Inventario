-- =====================================================================
--  DEVOLUCIONES: REABRIR Y RECIBIR DESDE EL PANEL (permiso de supervisor "dev_cerrar")
--  · Reabrir: una devolución cerrada vuelve a estar activa (si no se había recibido, bodega la ve de nuevo).
--  · Recibir desde el panel: cuando bodega no puede hacerlo en el celular, el supervisor registra lo que
--    llegó y termina la recepción. Sus líneas quedan marcadas "panel" (no pisan las que ya registró bodega).
--  Solo agrega funciones nuevas: la app anterior no cambia.
-- =====================================================================
create or replace function public.cb_dev_reabrir(p_clave text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'dev_cerrar');
  update cb_dev set finalizado = null, actualizado = now() where id = p_id and finalizado is not null;
  if not found then raise exception 'no_existe'; end if;
end $$;

create or replace function public.cb_dev_recibir_panel(p_clave text, p_id uuid, p_rec jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev; v_rec jsonb; v_por text := left(coalesce(cb_sup_nombre(p_clave), 'Administrador'), 70);
begin
  perform cb_puede(p_clave, 'dev_cerrar');
  if p_rec is null or jsonb_typeof(p_rec) <> 'array' or jsonb_array_length(p_rec) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_rec);
  select * into d from cb_dev where id = p_id for update;
  if not found or d.enviado is null then raise exception 'no_existe'; end if;
  if d.finalizado is not null then raise exception 'finalizado'; end if;
  if d.recibido is not null then raise exception 'ya_recibida'; end if;
  v_rec := cb_rec_mezclar(d.rec, (select coalesce(jsonb_agg(e || jsonb_build_object('user', v_por, 'panel', true)), '[]'::jsonb) from jsonb_array_elements(p_rec) e), 'panel');
  if jsonb_array_length(v_rec) = 0 then raise exception 'sin_productos'; end if;
  update cb_dev set rec = v_rec, rec_persona = left(v_por || ' (panel)', 80), rec_inicio = coalesce(rec_inicio, now()), recibido = now(), actualizado = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', now(), 'rec', v_rec);
end $$;

grant execute on function public.cb_dev_reabrir(text, uuid), public.cb_dev_recibir_panel(text, uuid, jsonb) to anon, authenticated;
