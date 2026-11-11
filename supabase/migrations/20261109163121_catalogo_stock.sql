
-- =====================================================================
--  Actualización 16 · Panel del supervisor en cualquier equipo (iPhone, otro PC)
--  Entrega al supervisor el último informe del ERP subido (productos + stock), para que el
--  panel muestre resultados con stock aunque en ese equipo no se haya cargado el archivo.
--  Solo agrega una función: la app anterior sigue funcionando igual.
-- =====================================================================

create or replace function public.cb_catalogo_stock(p_clave text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  return (select jsonb_build_object('items', items, 'stock', stock, 'origen', origen, 'actualizado', actualizado) from cb_catalogo where id = 1);
end $$;

revoke all on function public.cb_catalogo_stock(text) from public;
grant execute on function public.cb_catalogo_stock(text) to anon, authenticated;
