-- =====================================================================
--  Actualización 21 · Recepción de proveedores: bodega completa datos vacíos
--  En una recepción cargada desde el panel, el celular de bodega puede llenar el N° de guía,
--  el N° de referencia y el N° de contenedor SOLO si quedaron vacíos. Lo que ya escribió el
--  supervisor no cambia. Solo reemplaza una función: la app anterior sigue funcionando igual.
-- =====================================================================
create or replace function public.cb_prov_recibir(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_rec jsonb, p_terminar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov; v_fecha date; v_pers text := left(p_doc->>'persona', 80);
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then raise exception 'sin_permiso'; end if;
  if p_id is null then raise exception 'datos_invalidos'; end if;
  perform cb_prov_lineas_ok(p_rec);
  select * into p from cb_prov where id = p_id for update;
  if not found then
    insert into cb_prov(id, origen, persona, fecha) values (p_id, p_puesto, v_pers, (now() at time zone 'America/Santiago')::date)
    returning * into p;
  end if;
  if p.finalizado is not null then raise exception 'finalizado'; end if;
  if p.recibido is not null then raise exception 'ya_recibida'; end if;
  if p.origen = p_puesto then
    begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then v_fecha := null; end;
    update cb_prov set tipo = case when p_doc->>'tipo' = 'importacion' then 'importacion' else 'nacional' end,
           proveedor = left(trim(coalesce(p_doc->>'proveedor','')), 120), guia = left(trim(coalesce(p_doc->>'guia','')), 40),
           referencia = left(trim(coalesce(p_doc->>'referencia','')), 60), contenedor = left(trim(coalesce(p_doc->>'contenedor','')), 40), fecha = coalesce(v_fecha, fecha), nota = left(p_doc->>'nota', 300)
     where id = p_id
    returning * into p;
  else
    -- Recepción cargada en el panel: bodega solo completa lo que quedó vacío (no cambia lo que escribió el supervisor).
    update cb_prov set guia = case when coalesce(guia, '') = '' then left(trim(coalesce(p_doc->>'guia','')), 40) else guia end,
           referencia = case when coalesce(referencia, '') = '' then left(trim(coalesce(p_doc->>'referencia','')), 60) else referencia end,
           contenedor = case when coalesce(contenedor, '') = '' then left(trim(coalesce(p_doc->>'contenedor','')), 40) else contenedor end
     where id = p_id
    returning * into p;
  end if;
  if p_terminar then
    if jsonb_array_length(p_rec) = 0 then raise exception 'sin_productos'; end if;
    if coalesce(p.guia, '') = '' and coalesce(p.referencia, '') = '' then raise exception 'falta_documento'; end if;
  end if;
  update cb_prov set rec = p_rec, rec_persona = v_pers, rec_inicio = coalesce(rec_inicio, now()), actualizado = now(),
         recibido = case when p_terminar then now() else null end
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', case when p_terminar then now() end);
end $$;
