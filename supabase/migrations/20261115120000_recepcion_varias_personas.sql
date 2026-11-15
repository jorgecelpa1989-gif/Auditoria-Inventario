-- =====================================================================
--  RECEPCIÓN ENTRE VARIAS PERSONAS (proveedores y devoluciones)
--  Antes, cada celular mandaba su lista completa y el servidor la REEMPLAZABA: si dos personas
--  recibían el mismo documento, el último en guardar borraba las líneas del otro.
--  Ahora cada línea queda marcada con el usuario que la registró ("pu") y cada celular solo
--  reemplaza SUS líneas; las del otro se conservan tal como están en el servidor.
--  Líneas antiguas sin "pu": se comportan como antes (las reemplaza quien guarda).
--  Compatible con la app anterior: los parámetros no cambian; la respuesta suma "rec".
-- =====================================================================
create or replace function public.cb_rec_mezclar(p_old jsonb, p_new jsonb, p_pu text) returns jsonb
language sql immutable set search_path = public as $$
  with otros as (   -- líneas de otras personas: se quedan como están en el servidor
    select e from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) e
     where coalesce(e->>'pu', '') <> '' and e->>'pu' <> p_pu),
  mias as (         -- lo que manda este celular (sin las copias de líneas ajenas que pudo traer)
    select n.e || jsonb_build_object('pu', p_pu) e from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) n(e)
     where not exists (select 1 from otros o where o.e->>'lid' = n.e->>'lid'))
  select coalesce(jsonb_agg(e order by e->>'t', e->>'lid'), '[]'::jsonb) from (select e from otros union all select e from mias) x
$$;
revoke execute on function public.cb_rec_mezclar(jsonb, jsonb, text) from public, anon, authenticated;

create or replace function public.cb_prov_recibir(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_rec jsonb, p_terminar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov; v_fecha date; v_rec jsonb; v_pers text := left(p_doc->>'persona', 80);
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
  v_rec := cb_rec_mezclar(p.rec, p_rec, p_puesto);
  if p_terminar then
    if jsonb_array_length(v_rec) = 0 then raise exception 'sin_productos'; end if;
    if coalesce(p.guia, '') = '' and coalesce(p.referencia, '') = '' then raise exception 'falta_documento'; end if;
  end if;
  update cb_prov set rec = v_rec, rec_persona = v_pers, rec_inicio = coalesce(rec_inicio, now()), actualizado = now(),
         recibido = case when p_terminar then now() else null end
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', case when p_terminar then now() end, 'rec', v_rec);
end $$;

create or replace function public.cb_dev_recibir(p_puesto text, p_ses text, p_id uuid, p_persona text, p_rec jsonb, p_terminar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev; v_rec jsonb;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'dev_recibir') then raise exception 'sin_permiso'; end if;
  if p_rec is null or jsonb_typeof(p_rec) <> 'array' or jsonb_array_length(p_rec) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_rec);
  select * into d from cb_dev where id = p_id for update;
  if not found or d.enviado is null then raise exception 'no_existe'; end if;
  if d.finalizado is not null then raise exception 'finalizado'; end if;
  if d.recibido is not null then raise exception 'ya_recibida'; end if;
  v_rec := cb_rec_mezclar(d.rec, p_rec, p_puesto);
  if p_terminar and jsonb_array_length(v_rec) = 0 then raise exception 'sin_productos'; end if;
  update cb_dev set rec = v_rec, rec_persona = left(p_persona, 80), rec_inicio = coalesce(rec_inicio, now()), actualizado = now(),
         recibido = case when p_terminar then now() else null end
   where id = p_id;
  return jsonb_build_object('id', p_id, 'recibido', case when p_terminar then now() end, 'rec', v_rec);
end $$;
