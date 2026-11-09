
-- =====================================================================
--  Actualización 11 · Recuperar conteos en cualquier PC del supervisor
--  Devuelve los códigos (y la meta: rotativo / reconteo de) de varios conteos, para que el
--  panel muestre sus resultados aunque se hayan creado en otro equipo o en otra dirección.
--  Solo agrega una función: la app anterior sigue funcionando igual.
-- =====================================================================

create or replace function public.cb_conteo_codigos(p_clave text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_ids is null or array_length(p_ids, 1) is null then return '{}'::jsonb; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'datos_invalidos'; end if;
  return coalesce((select jsonb_object_agg(c.id::text, jsonb_build_object(
      'codes', (select coalesce(jsonb_agg(e->>0), '[]'::jsonb) from jsonb_array_elements(c.items) e),
      'meta', c.meta))
    from cb_conteos c where c.id = any(p_ids)), '{}'::jsonb);
end $$;

revoke all on function public.cb_conteo_codigos(text, uuid[]) from public;
grant execute on function public.cb_conteo_codigos(text, uuid[]) to anon, authenticated;
