
-- =====================================================================
--  Actualización 10 · Devoluciones: basta con N° de guía O N° de factura (no ambos obligatorios)
--  Solo cambia esa validación: la app anterior sigue funcionando igual.
-- =====================================================================

create or replace function public.cb_dev_guardar(p_puesto text, p_ses text, p_id uuid, p_doc jsonb, p_lect jsonb, p_enviar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d cb_dev; v_id uuid := p_id; v_fecha date;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'dev_cargar') then raise exception 'sin_permiso'; end if;
  if p_lect is null or jsonb_typeof(p_lect) <> 'array' or jsonb_array_length(p_lect) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_lect);
  begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then raise exception 'fecha_invalida'; end;
  if p_enviar then
    if coalesce(trim(p_doc->>'guia'),'') = '' and coalesce(trim(p_doc->>'factura'),'') = '' then raise exception 'falta_documento'; end if;
    if v_fecha is null then raise exception 'fecha_invalida'; end if;
    if jsonb_array_length(p_lect) = 0 then raise exception 'sin_productos'; end if;
  end if;
  if v_id is not null then
    select * into d from cb_dev where id = v_id for update;
    if not found then v_id := null;
    elsif d.origen <> p_puesto then raise exception 'sin_permiso';
    elsif d.rec_inicio is not null or d.finalizado is not null then raise exception 'en_recepcion';
    end if;
  end if;
  if v_id is null then
    insert into cb_dev(id, origen, area) values (coalesce(p_id, gen_random_uuid()), p_puesto, (select coalesce(nullif(area,''), nombre) from cb_puesto where id = p_puesto)) returning id into v_id;
  end if;
  update cb_dev set persona = left(coalesce(p_doc->>'persona', persona), 80), guia = left(trim(p_doc->>'guia'), 40),
         factura = left(trim(p_doc->>'factura'), 40), fecha = v_fecha, nota = left(p_doc->>'nota', 300),
         lect = p_lect, actualizado = now(), enviado = case when p_enviar then coalesce(enviado, now()) else enviado end
   where id = v_id;
  return jsonb_build_object('id', v_id, 'enviado', (select enviado from cb_dev where id = v_id));
end $$;

create or replace function public.cb_dev_crear_panel(p_clave text, p_area text, p_doc jsonb, p_lect jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_fecha date;
begin
  perform cb_check(p_clave);
  if p_lect is null or jsonb_typeof(p_lect) <> 'array' or jsonb_array_length(p_lect) = 0 then raise exception 'sin_productos'; end if;
  if jsonb_array_length(p_lect) > 5000 then raise exception 'datos_invalidos'; end if;
  perform cb_dev_codigos_ok(p_lect);
  if coalesce(trim(p_doc->>'guia'),'') = '' and coalesce(trim(p_doc->>'factura'),'') = '' then raise exception 'falta_documento'; end if;
  begin v_fecha := nullif(p_doc->>'fecha','')::date; exception when others then raise exception 'fecha_invalida'; end;
  if v_fecha is null then raise exception 'fecha_invalida'; end if;
  insert into cb_dev(origen, area, persona, guia, factura, fecha, nota, lect, enviado)
  values ('panel', left(coalesce(nullif(trim(p_area),''), 'Panel'), 60), left(p_doc->>'persona', 80), left(trim(p_doc->>'guia'), 40), left(trim(p_doc->>'factura'), 40),
          v_fecha, left(p_doc->>'nota', 300), p_lect, now())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
