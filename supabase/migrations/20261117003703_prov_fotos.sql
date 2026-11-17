-- =====================================================================
--  FOTOS DE LA RECEPCIÓN DE PROVEEDORES
--  Las fotos van a Supabase Storage (bucket privado "prov-fotos", ver 20261117120100). En la base solo
--  queda la lista de rutas en cb_prov.fotos. Subir y ver pasa por la Edge Function "prov-fotos", que
--  valida al usuario (sesión del celular) o al supervisor (clave) con estas funciones; solo ella las llama.
-- =====================================================================
alter table public.cb_prov add column if not exists fotos jsonb not null default '[]'::jsonb;

create or replace function public.cb_prov_foto_puede(p_puesto text, p_ses text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then raise exception 'sin_permiso'; end if;
  select * into p from cb_prov where id = p_id;
  if not found then raise exception 'no_existe'; end if;
  if p.anulado is not null then raise exception 'anulado'; end if;
  if p.finalizado is not null then raise exception 'finalizado'; end if;
  if jsonb_array_length(p.fotos) >= 6 then raise exception 'max_fotos'; end if;
end $$;

create or replace function public.cb_prov_foto_agregar(p_puesto text, p_ses text, p_id uuid, p_path text, p_persona text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare p cb_prov;
begin
  perform cb_prov_foto_puede(p_puesto, p_ses, p_id);
  if p_path is null or p_path not like p_id::text || '/%' or length(p_path) > 120 then raise exception 'datos_invalidos'; end if;
  select * into p from cb_prov where id = p_id for update;
  if jsonb_array_length(p.fotos) >= 6 then raise exception 'max_fotos'; end if;
  update cb_prov set fotos = fotos || jsonb_build_array(jsonb_build_object('path', p_path, 't', now(), 'persona', left(coalesce(p_persona, ''), 80), 'pu', p_puesto)),
         actualizado = now()
   where id = p_id;
  return jsonb_build_object('n', jsonb_array_length(p.fotos) + 1);
end $$;

create or replace function public.cb_prov_fotos(p_clave text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_puede(p_clave, 'prov_ver');
  return coalesce((select fotos from cb_prov where id = p_id), '[]'::jsonb);
end $$;

-- El celular sabe cuántas fotos ya tiene la recepción (para no pasar de 6)
CREATE OR REPLACE FUNCTION public.cb_prov_mis(p_puesto text, p_ses text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'prov_recibir') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'proveedor', p.proveedor, 'guia', p.guia, 'referencia', p.referencia, 'contenedor', p.contenedor,
      'fecha', p.fecha, 'nota', p.nota, 'origen', p.origen, 'persona', p.persona, 'esperado', p.esperado, 'rec', p.rec,
      'rec_persona', p.rec_persona, 'rec_inicio', p.rec_inicio, 'recibido', p.recibido, 'nfotos', jsonb_array_length(p.fotos)) order by p.creado)
    from cb_prov p where p.anulado is null and p.finalizado is null and (p.recibido is null or p.recibido > now() - interval '18 hours')), '[]'::jsonb);
end $function$;

-- Solo la Edge Function (service_role) las usa
revoke execute on function public.cb_prov_foto_puede(text, text, uuid), public.cb_prov_foto_agregar(text, text, uuid, text, text),
  public.cb_prov_fotos(text, uuid) from public, anon, authenticated;
grant execute on function public.cb_prov_foto_puede(text, text, uuid), public.cb_prov_foto_agregar(text, text, uuid, text, text),
  public.cb_prov_fotos(text, uuid) to service_role;
