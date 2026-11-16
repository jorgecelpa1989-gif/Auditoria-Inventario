-- Extender la vigencia de una entrega MP también reabre los lados que quedaron "terminados"
-- (ej.: Producción terminó la recepción vacía antes de que bodega entregara). Las lecturas no cambian.
create or replace function public.cb_mov_extender(p_clave text, p_id uuid, p_vence timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  perform cb_puede(p_clave, 'mp_operar');
  if p_vence is null or p_vence <= now() then raise exception 'datos_invalidos'; end if;
  update cb_mov set vence = p_vence
   where id = p_id and finalizado is null and coalesce(meta->>'estado', 'activa') = 'activa';
  if not found then raise exception 'no_existe'; end if;
  update cb_mov_lado set terminado = null where mov = p_id and terminado is not null;
  get diagnostics n = row_count;
  return jsonb_build_object('id', p_id, 'vence', p_vence, 'reabiertos', n);
end $$;
