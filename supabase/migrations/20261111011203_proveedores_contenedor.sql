-- =====================================================================
--  Actualización 20 · Recepción de proveedores: N° de contenedor
--  Agrega el campo "contenedor" (después del N° de referencia). Las líneas del packing list
--  ya guardan ABC, bultos por pallet y conversión del proveedor (no cambia la tabla).
--  Solo agrega: la app anterior sigue funcionando igual.
-- =====================================================================

alter table public.cb_prov add column if not exists contenedor text;

create or replace function public.cb_prov_guardar(p_clave text, p_id uuid, p_doc jsonb, p_esperado jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r text := cb_puede(p_clave, 'prov_operar'); v_id uuid := p_id; v_fecha date; p cb_prov;
begin
  perform cb_prov_lineas_ok(coalesce(p_esperado, '[]'::jsonb));
  begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then raise exception 'fecha_invalida'; end;
  if v_fecha is null then raise exception 'fecha_invalida'; end if;
  if coalesce(trim(p_doc->>'guia'),'') = '' and coalesce(trim(p_doc->>'referencia'),'') = '' then raise exception 'falta_documento'; end if;
  if v_id is not null then
    select * into p from cb_prov where id = v_id for update;
    if not found then v_id := null; elsif p.finalizado is not null then raise exception 'finalizado'; end if;
  end if;
  if v_id is null then
    insert into cb_prov(id, origen, persona) values (coalesce(p_id, gen_random_uuid()), 'panel', left(coalesce(cb_sup_nombre(p_clave), nullif(p_doc->>'persona',''), 'Supervisor'), 80))
    returning id into v_id;
  end if;
  update cb_prov set tipo = case when p_doc->>'tipo' = 'importacion' then 'importacion' else 'nacional' end,
         proveedor = left(trim(coalesce(p_doc->>'proveedor','')), 120), guia = left(trim(coalesce(p_doc->>'guia','')), 40),
         referencia = left(trim(coalesce(p_doc->>'referencia','')), 60), contenedor = left(trim(coalesce(p_doc->>'contenedor','')), 40), fecha = v_fecha, nota = left(p_doc->>'nota', 300),
         esperado = coalesce(p_esperado, '[]'::jsonb), actualizado = now()
   where id = v_id;
  return jsonb_build_object('id', v_id);
end $$;

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

create or replace function public.cb_prov_mis(p_puesto text, p_ses text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'proveedor', p.proveedor, 'guia', p.guia, 'referencia', p.referencia, 'contenedor', p.contenedor,
      'fecha', p.fecha, 'nota', p.nota, 'origen', p.origen, 'persona', p.persona, 'esperado', p.esperado, 'rec', p.rec,
      'rec_persona', p.rec_persona, 'rec_inicio', p.rec_inicio, 'recibido', p.recibido) order by p.creado)
    from cb_prov p where p.finalizado is null and (p.recibido is null or p.recibido > now() - interval '18 hours')), '[]'::jsonb);
end $$;
