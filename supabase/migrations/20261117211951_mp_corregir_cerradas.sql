-- Entrega MP: el supervisor también puede corregir registros de una entrega CERRADA (ajuste posterior, con historial).
-- Los celulares siguen sin poder enviar a una entrega cerrada (cb_mov_enviar). Lo anulado sigue bloqueado (trigger).
create or replace function public.cb_mov_corregir(p_clave text, p_id uuid, p_rol text, p_lid text, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'mp_operar'); m cb_mov; d jsonb; v_por text := left(coalesce(cb_sup_nombre(p_clave), 'Supervisor'), 80);
begin
  if p_rol not in ('E','R') then raise exception 'datos_invalidos'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  select * into m from cb_mov where id = p_id;
  if not found then raise exception 'no_existe'; end if;
  select data into d from cb_mov_lect where mov = p_id and rol = p_rol and lid = p_lid for update;
  if not found then raise exception 'no_existe'; end if;
  update cb_mov_lect set data = d || jsonb_build_object('qty', p_qty, 'ed', coalesce(d->'ed', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('de', d->'qty', 'a', p_qty, 'por', v_por, 't', now())))
   where mov = p_id and rol = p_rol and lid = p_lid;
  return jsonb_build_object('lid', p_lid, 'qty', p_qty);
end $$;
