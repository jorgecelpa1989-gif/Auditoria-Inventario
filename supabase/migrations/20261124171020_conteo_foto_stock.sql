-- =====================================================================
--  Foto del stock al finalizar un conteo: solo los SKU de ese conteo (stock, disponible, reserva),
--  con el archivo y la hora del stock usado. Así Resultados de un conteo cerrado no cambia al cargar
--  un stock nuevo. Solo agrega: columna nueva y 2 funciones; nada existente cambia.
--  Formato: {"f": archivo, "at": carga del stock, "bod": bodega, "t": hora de la foto, "s": {"cod": [stock, disp, res]}}
-- =====================================================================
alter table public.cb_conteos add column if not exists foto jsonb;

create or replace function public.cb_conteo_foto(p_clave text, p_id uuid, p_foto jsonb, p_forzar boolean default false) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_items int;
begin
  perform cb_puede(p_clave, 'inv_operar');
  if p_foto is null or jsonb_typeof(p_foto) <> 'object' or jsonb_typeof(p_foto->'s') <> 'object' or length(p_foto::text) > 3000000 then raise exception 'datos_invalidos'; end if;
  select jsonb_array_length(items) into v_items from cb_conteos where id = p_id;
  if not found then raise exception 'no_existe'; end if;
  if (select count(*) from jsonb_object_keys(p_foto->'s')) > v_items then raise exception 'datos_invalidos'; end if;   -- solo SKU del conteo
  update cb_conteos set foto = p_foto where id = p_id and (foto is null or coalesce(p_forzar, false));
  return found;
end $$;

create or replace function public.cb_conteo_fotos(p_clave text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'inv_ver');
  if p_ids is null or array_length(p_ids, 1) is null then return '{}'::jsonb; end if;
  if array_length(p_ids, 1) > 100 then raise exception 'datos_invalidos'; end if;
  return coalesce((select jsonb_object_agg(id::text, foto) from cb_conteos where id = any(p_ids) and foto is not null), '{}'::jsonb);
end $$;

revoke all on function public.cb_conteo_foto(text, uuid, jsonb, boolean), public.cb_conteo_fotos(text, uuid[]) from public;
grant execute on function public.cb_conteo_foto(text, uuid, jsonb, boolean), public.cb_conteo_fotos(text, uuid[]) to anon, authenticated;
